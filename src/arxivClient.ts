import axios, { AxiosInstance } from 'axios';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import NodeCache from 'node-cache';
import { PaperReference } from './commentParser';

export interface PaperMetadata {
    id: string;
    type: 'arxiv' | 'doi' | 'semantic_scholar';
    title: string;
    authors: string[];
    summary: string;
    published: string;
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

    // Rate limiters for each API (requests per second limits)
    private rateLimiters: Map<string, RateLimiter> = new Map([
        ['arxiv', { lastRequest: 0, minInterval: 334 }],      // 3 req/sec
        ['crossref', { lastRequest: 0, minInterval: 100 }],   // 10 req/sec (polite pool)
        ['semanticScholar', { lastRequest: 0, minInterval: 100 }]  // 10 req/sec
    ]);

    constructor(context: vscode.ExtensionContext) {
        // In-memory cache with 1 hour TTL
        this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

        // File-based persistent cache
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        this.fileCache = workspaceFolder
            ? path.join(workspaceFolder.uri.fsPath, '.vscode', 'paper-cache.json')
            : path.join(context.globalStorageUri.fsPath, 'paper-cache.json');

        // Shared axios instance with sensible defaults
        this.axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'ResearchPaperLinker/1.0 (VS Code Extension; mailto:your-email@example.com)'
            }
        });

        this.loadFileCache();
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
                    results.push(metadata);
                }
            });
            fetchPromises.push(fetchPromise);
        }

        // Wait for all fetches to complete
        await Promise.all(fetchPromises);
        return results;
    }

    private async fetchByType(paper: PaperReference): Promise<PaperMetadata | null> {
        switch (paper.type) {
            case 'arxiv':
                return this.fetchFromArxiv(paper.id, paper.version);
            case 'doi':
                return this.fetchFromCrossRef(paper.id);
            case 'semantic_scholar':
                return this.fetchFromSemanticScholar(paper.id);
            default:
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
                const metadata: PaperMetadata = {
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

                this.cacheMetadata(metadata);
                return metadata;
            }
        } catch (error: any) {
            console.warn(`arXiv API error for ${arxivId}:`, error.message);
        }

        return null;
    }

    private parseArxivXml(xmlData: string): any {
        // Check if we got valid results
        if (xmlData.includes('<opensearch:totalResults>0</opensearch:totalResults>')) {
            return null;
        }

        // Find the entry block
        const entryMatch = xmlData.match(/<entry>([\s\S]*?)<\/entry>/);
        if (!entryMatch) return null;

        const entry = entryMatch[1];

        // Parse title (skip feed title, get entry title)
        const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);

        // Parse summary/abstract
        const summaryMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);

        // Parse dates
        const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
        const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);

        // Parse authors
        const authorMatches = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)];

        // Parse categories
        const categoryMatches = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)];

        // Parse DOI if present
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
                headers: {
                    'Accept': 'application/json'
                }
            });

            const work = response.data?.message;
            if (work) {
                const metadata: PaperMetadata = {
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

                this.cacheMetadata(metadata);
                return metadata;
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
            if (a.given && a.family) {
                return `${a.given} ${a.family}`;
            }
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

                const metadata: PaperMetadata = {
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

                this.cacheMetadata(metadata);
                return metadata;
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
    private cacheMetadata(metadata: PaperMetadata): void {
        const cacheKey = `${metadata.type}:${metadata.id}`;
        this.cache.set(cacheKey, metadata);
        this.saveToFileCache(metadata);
    }

    private loadFileCache(): void {
        try {
            if (fs.existsSync(this.fileCache)) {
                const data = fs.readFileSync(this.fileCache, 'utf-8');
                const papers = JSON.parse(data) as PaperMetadata[];

                // Load into memory cache, respecting TTL
                const now = Date.now();
                const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

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

    private saveToFileCache(metadata: PaperMetadata): void {
        try {
            const dir = path.dirname(this.fileCache);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            let papers: PaperMetadata[] = [];
            if (fs.existsSync(this.fileCache)) {
                const data = fs.readFileSync(this.fileCache, 'utf-8');
                papers = JSON.parse(data);
            }

            const cacheKey = `${metadata.type}:${metadata.id}`;
            const index = papers.findIndex(p => `${p.type}:${p.id}` === cacheKey);

            if (index >= 0) {
                papers[index] = metadata;
            } else {
                papers.push(metadata);
            }

            // Prune old entries (keep last 500)
            if (papers.length > 500) {
                papers.sort((a, b) => b.fetchedAt - a.fetchedAt);
                papers = papers.slice(0, 500);
            }

            fs.writeFileSync(this.fileCache, JSON.stringify(papers, null, 2));
        } catch (error) {
            console.error('Error saving cache:', error);
        }
    }

    // Get cached metadata without fetching
    getCached(type: string, id: string): PaperMetadata | undefined {
        return this.cache.get(`${type}:${id}`);
    }

    // Clear all caches
    clearCache(): void {
        this.cache.flushAll();
        try {
            if (fs.existsSync(this.fileCache)) {
                fs.unlinkSync(this.fileCache);
            }
        } catch (error) {
            console.error('Error clearing file cache:', error);
        }
    }

    // Get cache statistics
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

// Keep backward compatibility alias
export { MetadataClient as ArxivClient };
