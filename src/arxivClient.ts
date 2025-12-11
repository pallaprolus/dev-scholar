import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import NodeCache from 'node-cache';
import { PaperReference } from './commentParser';
import { OpenAlexClient } from './openAlexClient';

export interface PaperMetadata {
    id: string;
    type: 'arxiv' | 'doi' | 'semantic_scholar' | 'openalex' | 'pmid' | 'ieee';
    title: string;
    authors: string[];
    summary: string;
    published?: string;
    updated?: string;
    categories?: string[];
    arxivUrl?: string;
    pdfUrl?: string;
    doiUrl?: string;
    doi?: string;
    journal?: string;
    volume?: string;
    pages?: string;
    citationCount?: number;
    fetchedAt: number;  // Timestamp for cache invalidation
}

interface RateLimiter {
    lastRequest: number;
    minInterval: number;
}

export class MetadataClient {
    private cache: NodeCache;
    private fileCache: string;
    private axiosInstance: AxiosInstance;
    private context: vscode.ExtensionContext;
    private openAlexClient: OpenAlexClient;

    // Rate limiters for each API (requests per second limits)
    private rateLimiters: Map<string, RateLimiter> = new Map([
        ['arxiv', { lastRequest: 0, minInterval: 334 }],      // 3 req/sec
        ['crossref', { lastRequest: 0, minInterval: 100 }],   // 10 req/sec (polite pool)
        ['semanticScholar', { lastRequest: 0, minInterval: 100 }]  // 10 req/sec
    ]);

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.openAlexClient = new OpenAlexClient();

        // In-memory cache with configurable TTL
        const config = vscode.workspace.getConfiguration('devscholar');
        const ttlDays = config.get<number>('cacheMaxAge') || 7;
        this.cache = new NodeCache({ stdTTL: ttlDays * 24 * 60 * 60 });

        // File-based persistent cache
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        this.fileCache = workspaceFolder
            ? path.join(workspaceFolder.uri.fsPath, '.vscode', 'paper-cache.json')
            : path.join(context.globalStorageUri.fsPath, 'paper-cache.json');

        // Shared axios instance with sensible defaults
        this.axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'DevScholar/0.3.1 (VS Code Extension; mailto:your-email@example.com)'
            }
        });

        this.loadDiskCache();
    }

    async fetchMetadata(papers: PaperReference[]): Promise<PaperMetadata[]> {
        const results: PaperMetadata[] = [];
        const fetchPromises: Promise<void>[] = [];

        for (const paper of papers) {
            const cacheKey = `${paper.type}:${paper.id}`;
            const cached = this.cache.get<PaperMetadata>(cacheKey);

            if (cached) {
                results.push(cached);
                continue;
            }

            // Queue fetch based on paper type
            const fetchPromise = this.fetchByType(paper).then(metadata => {
                if (metadata) {
                    this.cache.set(cacheKey, metadata);
                    results.push(metadata);
                }
            });
            fetchPromises.push(fetchPromise);
        }

        // Wait for all fetches to complete
        await Promise.all(fetchPromises);
        this.saveDiskCache();
        return results;
    }

    private async fetchByType(paper: PaperReference): Promise<PaperMetadata | null> {
        try {
            switch (paper.type) {
                case 'arxiv':
                    return this.fetchFromArxiv(paper.id, paper.version);
                case 'doi':
                    return this.fetchFromCrossRef(paper.id);
                case 'semantic_scholar':
                    return this.fetchFromSemanticScholar(paper.id);
                case 'openalex':
                case 'pmid':
                    const oaMeta = await this.openAlexClient.fetchMetadata(paper.id, paper.type);
                    return oaMeta ? { ...oaMeta, summary: oaMeta.summary || '', fetchedAt: Date.now() } : null;
                case 'ieee':
                    return {
                        id: paper.id,
                        type: 'ieee',
                        title: `IEEE Document ${paper.id}`,
                        authors: ['Unknown'],
                        summary: '',
                        journal: 'IEEE Xplore',
                        pdfUrl: `https://ieeexplore.ieee.org/document/${paper.id}`,
                        doiUrl: `https://ieeexplore.ieee.org/document/${paper.id}`,
                        fetchedAt: Date.now()
                    };
                default:
                    return null;
            }
        } catch (error) {
            console.error(`Error fetching ${paper.type}:${paper.id}`, error);
            return null;
        }
    }

    private async rateLimit(api: string): Promise<void> {
        const limiter = this.rateLimiters.get(api);
        if (!limiter) return;

        const now = Date.now();
        const elapsed = now - limiter.lastRequest;

        if (elapsed < limiter.minInterval) {
            await new Promise(resolve => setTimeout(resolve, limiter.minInterval - elapsed));
        }

        limiter.lastRequest = Date.now();
    }

    // ==================== arXiv API ====================
    private async fetchFromArxiv(arxivId: string, version?: string): Promise<PaperMetadata | null> {
        await this.rateLimit('arxiv');

        try {
            const queryId = version ? `${arxivId}v${version}` : arxivId;
            const response = await this.axiosInstance.get('https://export.arxiv.org/api/query', {
                params: {
                    id_list: queryId,
                    start: 0,
                    max_results: 1
                }
            });

            const entry = this.parseArxivXml(response.data);
            if (entry && entry.title) {
                return {
                    id: arxivId,
                    type: 'arxiv',
                    title: entry.title,
                    authors: entry.authors || [],
                    summary: entry.summary || '',
                    published: entry.published || '',
                    updated: entry.updated,
                    categories: entry.categories,
                    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
                    arxivUrl: `https://arxiv.org/abs/${arxivId}`,
                    doi: entry.doi,
                    doiUrl: entry.doi ? `https://doi.org/${entry.doi}` : undefined,
                    fetchedAt: Date.now()
                };
            }
        } catch (error: any) {
            console.warn(`arXiv API error for ${arxivId}:`, error.message);
        }

        return null;
    }

    private parseArxivXml(xmlData: string): any {
        if (xmlData.includes('<opensearch:totalResults>0</opensearch:totalResults>')) {
            return null;
        }

        const entryMatch = xmlData.match(/<entry>([\s\S]*?)<\/entry>/);
        if (!entryMatch) return null;

        const entry = entryMatch[1];
        const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
        const summaryMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
        const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
        const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);
        const authorMatches = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)];
        const categoryMatches = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)];
        const doiMatch = entry.match(/<arxiv:doi[^>]*>([^<]+)<\/arxiv:doi>/);

        return {
            title: titleMatch?.[1]?.trim().replace(/\s+/g, ' '),
            summary: summaryMatch?.[1]?.trim().replace(/\s+/g, ' '),
            published: publishedMatch?.[1],
            updated: updatedMatch?.[1],
            authors: authorMatches.map(m => m[1].trim()),
            categories: categoryMatches.map(m => m[1]),
            doi: doiMatch?.[1]
        };
    }

    // ==================== CrossRef API (DOI) ====================
    private async fetchFromCrossRef(doi: string): Promise<PaperMetadata | null> {
        await this.rateLimit('crossref');

        try {
            const response = await this.axiosInstance.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
                headers: { 'Accept': 'application/json' }
            });

            const work = response.data?.message;
            if (work) {
                return {
                    id: doi,
                    type: 'doi',
                    title: Array.isArray(work.title) ? work.title[0] : work.title || 'Unknown',
                    authors: this.parseCrossRefAuthors(work.author || []),
                    summary: work.abstract ? this.stripHtml(work.abstract) : '',
                    published: this.parseCrossRefDate(work.published || work.created),
                    doi: doi,
                    doiUrl: `https://doi.org/${doi}`,
                    journal: work['container-title']?.[0],
                    volume: work.volume,
                    pages: work.page,
                    fetchedAt: Date.now()
                };
            }
        } catch (error: any) {
            if (error.response?.status === 404) {
                console.warn(`CrossRef: DOI not found ${doi}`);
            } else {
                console.error(`CrossRef API error for ${doi}:`, error.message);
            }
        }
        return null;
    }

    private parseCrossRefAuthors(authors: any[]): string[] {
        return authors.map(a => {
            if (a.given && a.family) return `${a.given} ${a.family}`;
            return a.name || a.family || 'Unknown';
        });
    }

    private parseCrossRefDate(dateObj: any): string {
        if (!dateObj?.['date-parts']?.[0]) return '';
        const parts = dateObj['date-parts'][0];
        if (parts.length >= 3) {
            return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
        } else if (parts.length >= 1) {
            return String(parts[0]);
        }
        return '';
    }

    private stripHtml(html: string): string {
        return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    }

    // ==================== Semantic Scholar API ====================
    private async fetchFromSemanticScholar(corpusId: string): Promise<PaperMetadata | null> {
        await this.rateLimit('semanticScholar');

        try {
            const response = await this.axiosInstance.get(
                `https://api.semanticscholar.org/graph/v1/paper/CorpusId:${corpusId}`,
                {
                    params: {
                        fields: 'title,authors,abstract,year,citationCount,externalIds,publicationDate,journal'
                    }
                }
            );

            const paper = response.data;
            if (paper) {
                const arxivId = paper.externalIds?.ArXiv;
                const doi = paper.externalIds?.DOI;

                return {
                    id: corpusId,
                    type: 'semantic_scholar',
                    title: paper.title || 'Unknown',
                    authors: paper.authors?.map((a: any) => a.name) || [],
                    summary: paper.abstract || '',
                    published: paper.publicationDate || String(paper.year) || '',
                    citationCount: paper.citationCount,
                    journal: paper.journal?.name,
                    doi: doi,
                    doiUrl: doi ? `https://doi.org/${doi}` : undefined,
                    arxivUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined,
                    pdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : undefined,
                    fetchedAt: Date.now()
                };
            }
        } catch (error: any) {
            if (error.response?.status === 404) {
                console.warn(`Semantic Scholar: Paper not found for CorpusId:${corpusId}`);
            } else if (error.response?.status === 429) {
                console.warn(`Semantic Scholar: Rate limit exceeded for ${corpusId}`);
            } else {
                console.error(`Semantic Scholar API error for ${corpusId}:`, error.message);
            }
        }
        return null;
    }

    // ==================== Caching ====================
    private loadDiskCache(): void {
        try {
            if (fs.existsSync(this.fileCache)) {
                const data = fs.readFileSync(this.fileCache, 'utf-8');
                const papers = JSON.parse(data) as PaperMetadata[];
                const now = Date.now();
                // 7 days default
                const ttlDays = vscode.workspace.getConfiguration('devscholar').get<number>('cacheMaxAge') || 7;
                const maxAge = ttlDays * 24 * 60 * 60 * 1000;

                papers.forEach(p => {
                    if (now - p.fetchedAt < maxAge) {
                        const cacheKey = `${p.type}:${p.id}`;
                        this.cache.set(cacheKey, p);
                    }
                });
            }
        } catch (error) {
            console.error('Error loading file cache:', error);
        }
    }

    private saveDiskCache(): void {
        try {
            const dir = path.dirname(this.fileCache);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            let papers: PaperMetadata[] = [];
            // Merge valid memory cache into disk cache
            const keys = this.cache.keys();
            for (const key of keys) {
                const p = this.cache.get<PaperMetadata>(key);
                if (p) papers.push(p);
            }

            fs.writeFileSync(this.fileCache, JSON.stringify(papers, null, 2));
        } catch (error) {
            console.error('Error saving cache:', error);
        }
    }

    getCached(type: string, id: string): PaperMetadata | undefined {
        return this.cache.get(`${type}:${id}`);
    }

    clearCache(): void {
        this.cache.flushAll();
        try {
            if (fs.existsSync(this.fileCache)) fs.unlinkSync(this.fileCache);
        } catch (error) {
            console.error('Error clearing file cache:', error);
        }
    }

    getCacheStats(): { memoryCount: number; fileCount: number } {
        let fileCount = 0;
        try {
            if (fs.existsSync(this.fileCache)) {
                const data = fs.readFileSync(this.fileCache, 'utf-8');
                fileCount = JSON.parse(data).length;
            }
        } catch { }
        return {
            memoryCount: this.cache.keys().length,
            fileCount
        };
    }
}

export { MetadataClient as ArxivClient };
