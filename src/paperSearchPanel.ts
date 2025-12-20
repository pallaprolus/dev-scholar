import * as vscode from 'vscode';
import axios from 'axios';

interface SearchResult {
    id: string;
    title: string;
    authors: string[];
    year?: number;
    citationCount?: number;
    doi?: string;
    arxivId?: string;
}

interface PaperQuickPickItem extends vscode.QuickPickItem {
    paper?: SearchResult;
    citation?: string;
}

export class PaperSearchPanel {
    private searchCache: Map<string, { results: SearchResult[]; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly MIN_QUERY_LENGTH = 3;
    private currentSearch: AbortController | null = null;

    async show(): Promise<string | undefined> {
        const quickPick = vscode.window.createQuickPick<PaperQuickPickItem>();
        quickPick.placeholder = 'Type to search for papers (minimum 3 characters)...';
        quickPick.title = '📚 Search Papers - Click-to-Cite';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        // Debounce timer
        let debounceTimer: NodeJS.Timeout | undefined;

        return new Promise<string | undefined>((resolve) => {
            // Handle value changes with debounce
            quickPick.onDidChangeValue(async (value) => {
                // Clear previous timer
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }

                // Cancel previous search
                if (this.currentSearch) {
                    this.currentSearch.abort();
                }

                const query = value.trim();

                if (query.length < this.MIN_QUERY_LENGTH) {
                    quickPick.items = [{
                        label: '$(search) Type at least 3 characters to search...',
                        alwaysShow: true
                    }];
                    quickPick.busy = false;
                    return;
                }

                // Show loading state
                quickPick.busy = true;
                quickPick.items = [{
                    label: '$(loading~spin) Searching...',
                    alwaysShow: true
                }];

                // Debounce the search (300ms)
                debounceTimer = setTimeout(async () => {
                    const results = await this.searchPapers(query);
                    quickPick.busy = false;

                    if (results.length === 0) {
                        quickPick.items = [{
                            label: `$(warning) No papers found for "${query}"`,
                            alwaysShow: true
                        }];
                        return;
                    }

                    // Convert to QuickPick items
                    quickPick.items = results.map(paper => this.createQuickPickItem(paper));
                }, 300);
            });

            // Handle selection
            quickPick.onDidAccept(() => {
                const selected = quickPick.selectedItems[0];
                if (selected?.citation) {
                    resolve(selected.citation);
                    quickPick.hide();
                }
            });

            // Handle dismissal
            quickPick.onDidHide(() => {
                if (debounceTimer) {
                    clearTimeout(debounceTimer);
                }
                quickPick.dispose();
                resolve(undefined);
            });

            // Show initial state
            quickPick.items = [{
                label: '$(search) Type at least 3 characters to search...',
                alwaysShow: true
            }];

            quickPick.show();
        });
    }

    private createQuickPickItem(paper: SearchResult): PaperQuickPickItem {
        // Build citation string
        let citation: string;
        if (paper.arxivId) {
            citation = `arxiv:${paper.arxivId}`;
        } else if (paper.doi) {
            citation = `doi:${paper.doi}`;
        } else {
            citation = `openalex:${paper.id}`;
        }

        // Format authors
        const authorsDisplay = paper.authors.length > 3
            ? `${paper.authors.slice(0, 3).join(', ')} et al.`
            : paper.authors.join(', ');

        // Build description with metadata
        const descParts: string[] = [];
        if (paper.year) {
            descParts.push(`$(calendar) ${paper.year}`);
        }
        if (paper.citationCount !== undefined && paper.citationCount > 0) {
            descParts.push(`$(quote) ${paper.citationCount} citations`);
        }

        // Build detail line
        const detailParts: string[] = [`$(person) ${authorsDisplay}`];
        if (paper.doi) {
            detailParts.push(`DOI: ${paper.doi}`);
        } else if (paper.arxivId) {
            detailParts.push(`arXiv: ${paper.arxivId}`);
        }

        return {
            label: `$(book) ${paper.title}`,
            description: descParts.join('  '),
            detail: detailParts.join('  |  '),
            paper: paper,
            citation: citation,
            alwaysShow: true
        };
    }

    private async searchPapers(query: string): Promise<SearchResult[]> {
        // Check cache
        const cacheKey = query.toLowerCase();
        const cached = this.searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.results;
        }

        // Create abort controller for this search
        this.currentSearch = new AbortController();

        try {
            const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=15&select=id,title,authorships,publication_year,cited_by_count,doi,ids`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'mailto:devscholar-extension@example.com' },
                timeout: 8000,
                signal: this.currentSearch.signal
            });

            if (response.data?.results) {
                const results: SearchResult[] = response.data.results.map((work: any) => {
                    // Extract arXiv ID if available
                    let arxivId: string | undefined;
                    if (work.ids?.arxiv) {
                        arxivId = work.ids.arxiv.replace('https://arxiv.org/abs/', '');
                    }

                    return {
                        id: work.id?.replace('https://openalex.org/', '') || '',
                        title: work.title || 'Unknown Title',
                        authors: work.authorships?.slice(0, 5).map((a: any) => a.author?.display_name || 'Unknown') || [],
                        year: work.publication_year,
                        citationCount: work.cited_by_count,
                        doi: work.doi?.replace('https://doi.org/', ''),
                        arxivId: arxivId
                    };
                });

                // Cache results
                this.searchCache.set(cacheKey, { results, timestamp: Date.now() });
                return results;
            }
        } catch (error: any) {
            if (error.name !== 'CanceledError' && error.code !== 'ERR_CANCELED') {
                console.warn('Paper search failed:', error.message);
            }
        }

        return [];
    }

    clearCache(): void {
        this.searchCache.clear();
    }
}
