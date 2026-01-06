import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import * as http from 'http';
import { PaperMetadata } from './arxivClient';

const MENDELEY_ACCESS_TOKEN_SECRET = 'devscholar.mendeleyAccessToken';
const MENDELEY_REFRESH_TOKEN_SECRET = 'devscholar.mendeleyRefreshToken';
const MENDELEY_TOKEN_EXPIRY_SECRET = 'devscholar.mendeleyTokenExpiry';

export interface MendeleyFolder {
    id: string;
    name: string;
    parent_id?: string;
    created: string;
}

export interface MendeleyDocument {
    id: string;
    title: string;
    type: string;
    authors?: Array<{ first_name?: string; last_name: string }>;
    abstract?: string;
    year?: number;
    source?: string;
    volume?: string;
    pages?: string;
    identifiers?: {
        doi?: string;
        arxiv?: string;
        pmid?: string;
        issn?: string;
    };
    keywords?: string[];
    websites?: string[];
    folder_uuids?: string[];
    created: string;
    last_modified: string;
}

interface OAuthTokens {
    access_token: string;
    refresh_token: string;
    expires_in: number;
}

export class MendeleySync {
    private baseUrl = 'https://api.mendeley.com';
    private authUrl = 'https://api.mendeley.com/oauth/authorize';
    private tokenUrl = 'https://api.mendeley.com/oauth/token';
    private axiosInstance: AxiosInstance;
    private secretStorage: vscode.SecretStorage;
    private callbackServer: http.Server | null = null;
    private readonly redirectPort = 45678;
    private readonly redirectUri = `http://localhost:${this.redirectPort}/callback`;

    constructor(context: vscode.ExtensionContext) {
        this.secretStorage = context.secrets;
        this.axiosInstance = axios.create({
            timeout: 15000,
            headers: {
                'User-Agent': 'DevScholar-Extension/0.6.1'
            }
        });
    }

    // ==================== OAuth2 Authentication ====================

    private getClientId(): string | undefined {
        return vscode.workspace.getConfiguration('devscholar').get<string>('mendeleyClientId');
    }

    private getClientSecret(): string | undefined {
        return vscode.workspace.getConfiguration('devscholar').get<string>('mendeleyClientSecret');
    }

    async getAccessToken(): Promise<string | undefined> {
        return await this.secretStorage.get(MENDELEY_ACCESS_TOKEN_SECRET);
    }

    async getRefreshToken(): Promise<string | undefined> {
        return await this.secretStorage.get(MENDELEY_REFRESH_TOKEN_SECRET);
    }

    private async getTokenExpiry(): Promise<number | undefined> {
        const expiry = await this.secretStorage.get(MENDELEY_TOKEN_EXPIRY_SECRET);
        return expiry ? parseInt(expiry) : undefined;
    }

    private async storeTokens(tokens: OAuthTokens): Promise<void> {
        const expiryTime = Date.now() + (tokens.expires_in * 1000);
        await this.secretStorage.store(MENDELEY_ACCESS_TOKEN_SECRET, tokens.access_token);
        await this.secretStorage.store(MENDELEY_REFRESH_TOKEN_SECRET, tokens.refresh_token);
        await this.secretStorage.store(MENDELEY_TOKEN_EXPIRY_SECRET, expiryTime.toString());
    }

    async deleteTokens(): Promise<void> {
        await this.secretStorage.delete(MENDELEY_ACCESS_TOKEN_SECRET);
        await this.secretStorage.delete(MENDELEY_REFRESH_TOKEN_SECRET);
        await this.secretStorage.delete(MENDELEY_TOKEN_EXPIRY_SECRET);
    }

    async isConfigured(): Promise<boolean> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();
        const accessToken = await this.getAccessToken();
        return !!(clientId && clientSecret && accessToken);
    }

    async isTokenValid(): Promise<boolean> {
        const expiry = await this.getTokenExpiry();
        if (!expiry) return false;
        // Consider token invalid 5 minutes before expiry
        return Date.now() < (expiry - 5 * 60 * 1000);
    }

    /**
     * Ensure we have a valid access token, refreshing if necessary
     */
    async ensureValidToken(): Promise<string | null> {
        if (await this.isTokenValid()) {
            return await this.getAccessToken() || null;
        }

        // Try to refresh
        const refreshToken = await this.getRefreshToken();
        if (refreshToken) {
            try {
                await this.refreshAccessToken(refreshToken);
                return await this.getAccessToken() || null;
            } catch (error) {
                console.error('Failed to refresh Mendeley token:', error);
            }
        }

        return null;
    }

    /**
     * Start OAuth2 authorization flow
     */
    async authorize(): Promise<boolean> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            vscode.window.showErrorMessage(
                'Mendeley Client ID and Secret not configured. Please set them in settings.'
            );
            return false;
        }

        return new Promise((resolve) => {
            // Generate state for CSRF protection
            const state = Math.random().toString(36).substring(2, 15);

            // Start local callback server
            this.callbackServer = http.createServer(async (req, res) => {
                const url = new URL(req.url || '', `http://localhost:${this.redirectPort}`);

                if (url.pathname === '/callback') {
                    const code = url.searchParams.get('code');
                    const returnedState = url.searchParams.get('state');

                    if (returnedState !== state) {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('<html><body><h1>Error: State mismatch</h1><p>You can close this window.</p></body></html>');
                        this.closeCallbackServer();
                        resolve(false);
                        return;
                    }

                    if (code) {
                        try {
                            await this.exchangeCodeForToken(code, clientId, clientSecret);
                            res.writeHead(200, { 'Content-Type': 'text/html' });
                            res.end('<html><body><h1>Success!</h1><p>DevScholar is now connected to Mendeley. You can close this window.</p></body></html>');
                            vscode.window.showInformationMessage('Successfully connected to Mendeley!');
                            this.closeCallbackServer();
                            resolve(true);
                        } catch (error: any) {
                            res.writeHead(500, { 'Content-Type': 'text/html' });
                            res.end(`<html><body><h1>Error</h1><p>${error.message}</p></body></html>`);
                            this.closeCallbackServer();
                            resolve(false);
                        }
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/html' });
                        res.end('<html><body><h1>Error: No code received</h1></body></html>');
                        this.closeCallbackServer();
                        resolve(false);
                    }
                }
            });

            this.callbackServer.listen(this.redirectPort, () => {
                // Open browser for authorization
                const authUrl = `${this.authUrl}?client_id=${clientId}&redirect_uri=${encodeURIComponent(this.redirectUri)}&response_type=code&scope=all&state=${state}`;
                vscode.env.openExternal(vscode.Uri.parse(authUrl));
            });

            this.callbackServer.on('error', (err) => {
                vscode.window.showErrorMessage(`Failed to start OAuth callback server: ${err.message}`);
                resolve(false);
            });

            // Timeout after 5 minutes
            setTimeout(() => {
                if (this.callbackServer) {
                    this.closeCallbackServer();
                    resolve(false);
                }
            }, 5 * 60 * 1000);
        });
    }

    private closeCallbackServer(): void {
        if (this.callbackServer) {
            this.callbackServer.close();
            this.callbackServer = null;
        }
    }

    private async exchangeCodeForToken(code: string, clientId: string, clientSecret: string): Promise<void> {
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const response = await this.axiosInstance.post(
            this.tokenUrl,
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.redirectUri
            }).toString(),
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        await this.storeTokens(response.data);
    }

    private async refreshAccessToken(refreshToken: string): Promise<void> {
        const clientId = this.getClientId();
        const clientSecret = this.getClientSecret();

        if (!clientId || !clientSecret) {
            throw new Error('Mendeley credentials not configured');
        }

        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const response = await this.axiosInstance.post(
            this.tokenUrl,
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                redirect_uri: this.redirectUri
            }).toString(),
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        await this.storeTokens(response.data);
    }

    private async getAuthHeaders(): Promise<{ Authorization: string; 'Content-Type': string } | null> {
        const accessToken = await this.ensureValidToken();
        if (!accessToken) return null;
        return {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        };
    }

    // ==================== Folders ====================

    /**
     * Fetch all folders from user's Mendeley library
     */
    async fetchFolders(): Promise<MendeleyFolder[]> {
        const headers = await this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not authenticated');
        }

        try {
            const response = await this.axiosInstance.get(
                `${this.baseUrl}/folders`,
                { headers }
            );
            return response.data;
        } catch (error: any) {
            if (error.response?.status === 401) {
                throw new Error('Mendeley: Unauthorized. Please re-authenticate.');
            }
            throw error;
        }
    }

    /**
     * Create a new folder in Mendeley
     */
    async createFolder(name: string): Promise<MendeleyFolder> {
        const headers = await this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not authenticated');
        }

        const response = await this.axiosInstance.post(
            `${this.baseUrl}/folders`,
            { name },
            { headers }
        );

        return response.data;
    }

    /**
     * Show QuickPick to select or create a folder
     */
    async promptForFolder(): Promise<MendeleyFolder | undefined> {
        const folders = await this.fetchFolders();

        const items: vscode.QuickPickItem[] = [
            { label: '$(add) Create New Folder...', description: 'Create a new Mendeley folder for this workspace' },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            ...folders.map(f => ({
                label: f.name,
                description: f.id
            }))
        ];

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a Mendeley folder to link with this workspace',
            title: 'Link Mendeley Folder'
        });

        if (!selected) return undefined;

        if (selected.label.includes('Create New Folder')) {
            const name = await vscode.window.showInputBox({
                prompt: 'Enter folder name',
                placeHolder: 'e.g., ML-Research-Project',
                value: vscode.workspace.name || 'DevScholar'
            });

            if (name) {
                const newFolder = await this.createFolder(name);
                vscode.window.showInformationMessage(`Created Mendeley folder: ${name}`);
                return newFolder;
            }
            return undefined;
        }

        return folders.find(f => f.name === selected.label);
    }

    // ==================== Fetch Documents (Import) ====================

    /**
     * Fetch documents from a specific folder
     */
    async fetchDocumentsFromFolder(folderId: string): Promise<MendeleyDocument[]> {
        const headers = await this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not authenticated');
        }

        const documents: MendeleyDocument[] = [];
        let marker: string | undefined;
        const limit = 50;

        while (true) {
            const params: any = { folder_id: folderId, limit, view: 'all' };
            if (marker) params.marker = marker;

            const response = await this.axiosInstance.get(
                `${this.baseUrl}/documents`,
                { headers, params }
            );

            documents.push(...response.data);

            // Check for next page via Link header
            const linkHeader = response.headers['link'];
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const nextMatch = linkHeader.match(/marker=([^&>]+)/);
                marker = nextMatch ? nextMatch[1] : undefined;
            } else {
                break;
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 200));
        }

        return documents;
    }

    /**
     * Fetch all documents from user's library
     */
    async fetchAllDocuments(): Promise<MendeleyDocument[]> {
        const headers = await this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not authenticated');
        }

        const documents: MendeleyDocument[] = [];
        let marker: string | undefined;
        const limit = 50;

        while (true) {
            const params: any = { limit, view: 'all' };
            if (marker) params.marker = marker;

            const response = await this.axiosInstance.get(
                `${this.baseUrl}/documents`,
                { headers, params }
            );

            documents.push(...response.data);

            const linkHeader = response.headers['link'];
            if (linkHeader && linkHeader.includes('rel="next"')) {
                const nextMatch = linkHeader.match(/marker=([^&>]+)/);
                marker = nextMatch ? nextMatch[1] : undefined;
            } else {
                break;
            }

            await new Promise(r => setTimeout(r, 200));
        }

        return documents;
    }

    /**
     * Convert Mendeley document to PaperMetadata
     */
    mapFromMendeleyDocument(doc: MendeleyDocument): PaperMetadata {
        const authors = (doc.authors || [])
            .map(a => `${a.first_name ? a.first_name + ' ' : ''}${a.last_name}`.trim());

        // Determine type and ID
        let id = doc.identifiers?.doi || doc.id;
        let type: PaperMetadata['type'] = 'doi';

        if (doc.identifiers?.arxiv) {
            type = 'arxiv';
            id = doc.identifiers.arxiv;
        } else if (doc.identifiers?.doi) {
            type = 'doi';
            id = doc.identifiers.doi;
        }

        return {
            id,
            type,
            title: doc.title,
            authors,
            summary: doc.abstract || '',
            published: doc.year?.toString(),
            journal: doc.source,
            volume: doc.volume,
            pages: doc.pages,
            doi: doc.identifiers?.doi,
            doiUrl: doc.identifiers?.doi ? `https://doi.org/${doc.identifiers.doi}` : undefined,
            arxivUrl: doc.identifiers?.arxiv ? `https://arxiv.org/abs/${doc.identifiers.arxiv}` : undefined,
            pdfUrl: doc.websites?.[0],
            categories: doc.keywords,
            fetchedAt: Date.now()
        };
    }

    /**
     * Format a citation for insertion into code
     */
    formatCitation(paper: PaperMetadata, languageId: string): string {
        const commentPrefix = this.getCommentPrefix(languageId);
        const idStr = paper.type === 'arxiv' ? `arxiv:${paper.id}` :
            paper.type === 'doi' ? `doi:${paper.id}` :
                `${paper.type}:${paper.id}`;

        return `${commentPrefix} "${paper.title}"\n${commentPrefix} ${idStr}`;
    }

    private getCommentPrefix(languageId: string): string {
        const commentMap: Record<string, string> = {
            'python': '#',
            'javascript': '//',
            'typescript': '//',
            'java': '//',
            'c': '//',
            'cpp': '//',
            'csharp': '//',
            'go': '//',
            'rust': '//',
            'swift': '//',
            'kotlin': '//',
            'ruby': '#',
            'perl': '#',
            'r': '#',
            'shell': '#',
            'bash': '#',
            'powershell': '#',
            'sql': '--',
            'lua': '--',
            'haskell': '--',
            'latex': '%',
            'matlab': '%',
            'html': '<!--',
            'xml': '<!--',
            'css': '/*',
            'scss': '//',
            'yaml': '#',
            'toml': '#',
            'dockerfile': '#'
        };
        return commentMap[languageId] || '#';
    }

    // ==================== Export (Sync to Mendeley) ====================

    /**
     * Sync papers to Mendeley, optionally to a specific folder
     */
    async syncPapers(papers: PaperMetadata[], folderId?: string): Promise<void> {
        const headers = await this.getAuthHeaders();
        if (!headers) {
            throw new Error('Mendeley not authenticated');
        }

        let successCount = 0;
        let skipCount = 0;
        let failCount = 0;

        // Fetch existing documents to check for duplicates
        let existingDocs: MendeleyDocument[] = [];
        try {
            existingDocs = folderId
                ? await this.fetchDocumentsFromFolder(folderId)
                : await this.fetchAllDocuments();
        } catch (e) {
            console.warn('Could not fetch existing documents for duplicate check:', e);
        }

        for (const paper of papers) {
            try {
                // Check for existing document
                const existing = this.findExistingDocument(paper, existingDocs);
                if (existing) {
                    // If folder specified and doc not in folder, add it
                    if (folderId && !existing.folder_uuids?.includes(folderId)) {
                        await this.addDocumentToFolder(existing.id, folderId);
                        successCount++;
                    } else {
                        skipCount++;
                    }
                    continue;
                }

                // Create new document
                const mendeleyDoc = this.mapToMendeleyDocument(paper, folderId);
                await this.axiosInstance.post(
                    `${this.baseUrl}/documents`,
                    mendeleyDoc,
                    { headers }
                );
                successCount++;

                // Rate limiting
                await new Promise(r => setTimeout(r, 200));
            } catch (error: any) {
                console.error(`Failed to sync paper ${paper.title}:`, error);
                failCount++;
                if (error.response?.status === 401) {
                    vscode.window.showErrorMessage('Mendeley: Unauthorized. Please re-authenticate.');
                    return;
                }
            }
        }

        const msg = [];
        if (successCount > 0) msg.push(`${successCount} synced`);
        if (skipCount > 0) msg.push(`${skipCount} already exist`);
        if (failCount > 0) msg.push(`${failCount} failed`);

        if (failCount > 0) {
            vscode.window.showWarningMessage(`Mendeley: ${msg.join(', ')}`);
        } else {
            vscode.window.showInformationMessage(`Mendeley: ${msg.join(', ')}`);
        }
    }

    private async addDocumentToFolder(docId: string, folderId: string): Promise<void> {
        const headers = await this.getAuthHeaders();
        if (!headers) throw new Error('Not authenticated');

        await this.axiosInstance.post(
            `${this.baseUrl}/folders/${folderId}/documents`,
            { id: docId },
            { headers }
        );
    }

    private findExistingDocument(paper: PaperMetadata, docs: MendeleyDocument[]): MendeleyDocument | undefined {
        return docs.find(doc => {
            // Check DOI
            if (paper.doi && doc.identifiers?.doi === paper.doi) {
                return true;
            }

            // Check arXiv ID
            if (paper.type === 'arxiv' && doc.identifiers?.arxiv === paper.id) {
                return true;
            }

            // Check title similarity (exact match)
            if (doc.title.toLowerCase() === paper.title.toLowerCase()) {
                return true;
            }

            return false;
        });
    }

    private mapToMendeleyDocument(paper: PaperMetadata, folderId?: string): any {
        const doc: any = {
            type: paper.journal ? 'journal' : 'generic',
            title: paper.title,
            authors: paper.authors.map(name => {
                const parts = name.split(' ');
                return {
                    first_name: parts.slice(0, -1).join(' '),
                    last_name: parts[parts.length - 1] || parts[0]
                };
            }),
            abstract: paper.summary,
            source: paper.journal || (paper.type === 'arxiv' ? 'arXiv' : ''),
            volume: paper.volume,
            pages: paper.pages,
            year: paper.published ? parseInt(paper.published.substring(0, 4)) : undefined,
            identifiers: {} as any,
            keywords: paper.categories,
            websites: [] as string[]
        };

        if (paper.doi) {
            doc.identifiers.doi = paper.doi;
        }
        if (paper.type === 'arxiv') {
            doc.identifiers.arxiv = paper.id;
        }

        if (paper.pdfUrl) {
            doc.websites.push(paper.pdfUrl);
        } else if (paper.arxivUrl) {
            doc.websites.push(paper.arxivUrl);
        } else if (paper.doiUrl) {
            doc.websites.push(paper.doiUrl);
        }

        if (folderId) {
            doc.folder_uuids = [folderId];
        }

        return doc;
    }
}
