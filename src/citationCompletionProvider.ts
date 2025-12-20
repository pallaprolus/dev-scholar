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

/**
 * Completion provider that shows paper search results directly in the autocomplete dropdown.
 * Triggers on #cite:, @cite:, or cite: patterns.
 */
export class CitationCompletionProvider implements vscode.CompletionItemProvider {
    private searchCache: Map<string, { results: SearchResult[]; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private readonly MIN_QUERY_LENGTH = 3;

    // Pattern to match cite triggers with query
    // Matches: #cite:query, @cite:query, cite:query (case insensitive)
    private readonly TRIGGER_PATTERN = /(?:#cite:|@cite:|cite:)\s*(.*)$/i;

    // Pattern to find where the trigger starts
    private readonly TRIGGER_START_PATTERN = /(#cite:|@cite:|cite:)/i;

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionList | null> {
        try {
            // Get the current line text up to cursor
            const lineText = document.lineAt(position.line).text;
            const linePrefix = lineText.substring(0, position.character);

            // Check for trigger pattern
            const match = linePrefix.match(this.TRIGGER_PATTERN);
            if (!match) {
                return null;
            }

            const query = match[1].trim();

            // Find where the trigger starts in the line
            const triggerStartMatch = linePrefix.match(this.TRIGGER_START_PATTERN);
            if (!triggerStartMatch) {
                return null;
            }

            const triggerIndex = linePrefix.lastIndexOf(triggerStartMatch[1]);
            const replaceRange = new vscode.Range(
                new vscode.Position(position.line, triggerIndex),
                position
            );

            // If query is too short, show a helper item
            if (query.length < this.MIN_QUERY_LENGTH) {
                return this.createHelperList(query, replaceRange);
            }

            // Check cancellation before API call
            if (token.isCancellationRequested) {
                return null;
            }

            // Search for papers
            const results = await this.searchPapers(query);

            // Check cancellation after API call
            if (token.isCancellationRequested) {
                return null;
            }

            if (results.length === 0) {
                return this.createNoResultsList(query, replaceRange);
            }

            // Get comment prefix for the current language
            const commentPrefix = this.getCommentPrefix(document.languageId);

            // Convert search results to completion items
            const items = results.map((result, index) =>
                this.createCompletionItem(result, index, replaceRange, query, commentPrefix)
            );

            // Return as incomplete=true so VS Code re-queries as user types
            return new vscode.CompletionList(items, true);

        } catch (error) {
            console.error('CitationCompletionProvider error:', error);
            return null;
        }
    }

    private createHelperList(query: string, replaceRange: vscode.Range): vscode.CompletionList {
        const remaining = this.MIN_QUERY_LENGTH - query.length;
        const helperItem = new vscode.CompletionItem(
            `Type ${remaining} more character${remaining > 1 ? 's' : ''} to search...`,
            vscode.CompletionItemKind.Text
        );
        helperItem.detail = 'Paper search requires at least 3 characters';
        helperItem.sortText = '0000';
        helperItem.filterText = this.buildFilterText(query || 'cite');
        // Keep the current text, don't replace anything
        helperItem.insertText = '';
        helperItem.command = {
            title: 'Trigger Suggest',
            command: 'editor.action.triggerSuggest'
        };

        return new vscode.CompletionList([helperItem], true);
    }

    private createNoResultsList(query: string, replaceRange: vscode.Range): vscode.CompletionList {
        const noResultItem = new vscode.CompletionItem(
            `No papers found for "${query}"`,
            vscode.CompletionItemKind.Text
        );
        noResultItem.detail = 'Try different keywords';
        noResultItem.sortText = '0000';
        noResultItem.filterText = this.buildFilterText(query, 'no papers found search');
        noResultItem.insertText = '';

        return new vscode.CompletionList([noResultItem], true);
    }

    private buildFilterText(query: string, title?: string): string {
        // Build a comprehensive filter text that keeps items visible
        // Include the trigger patterns, query, and optionally title words
        const parts = [
            `cite:${query}`,
            `@cite:${query}`,
            `#cite:${query}`,
            query
        ];

        // Add individual words from query for multi-word searches
        const words = query.split(/\s+/).filter(w => w.length > 0);
        if (words.length > 1) {
            words.forEach(word => {
                parts.push(`cite:${word}`);
                parts.push(word);
            });
        }

        // Add title words if provided
        if (title) {
            const titleWords = title.split(/\s+/).slice(0, 5);
            parts.push(...titleWords);
        }

        return parts.join(' ');
    }

    async resolveCompletionItem(
        item: vscode.CompletionItem,
        token: vscode.CancellationToken
    ): Promise<vscode.CompletionItem> {
        return item;
    }

    // Validate DOI format - must match standard DOI pattern
    // Valid DOI: 10.XXXX/... where XXXX is registrant code
    private isValidDoi(doi: string | undefined): boolean {
        if (!doi) return false;
        // DOI pattern: 10.XXXX/suffix where suffix contains alphanumeric, dots, dashes, underscores, slashes
        const doiPattern = /^10\.\d{4,}\/[^\s]+$/;
        return doiPattern.test(doi);
    }

    private async searchPapers(query: string): Promise<SearchResult[]> {
        // Check cache first
        const cacheKey = query.toLowerCase().trim();
        const cached = this.searchCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.results;
        }

        try {
            const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per_page=10&select=id,title,authorships,publication_year,cited_by_count,doi,ids`;

            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'DevScholar-VSCode-Extension (mailto:devscholar@example.com)'
                },
                timeout: 5000
            });

            if (response.data?.results) {
                const results: SearchResult[] = response.data.results
                    .filter((work: any) => work.title) // Filter out items without titles
                    .map((work: any) => {
                        let arxivId: string | undefined;
                        if (work.ids?.arxiv) {
                            arxivId = work.ids.arxiv.replace('https://arxiv.org/abs/', '');
                        }

                        // Extract and validate DOI
                        let doi: string | undefined;
                        const rawDoi = work.doi?.replace('https://doi.org/', '');
                        if (this.isValidDoi(rawDoi)) {
                            doi = rawDoi;
                        }

                        return {
                            id: work.id?.replace('https://openalex.org/', '') || '',
                            title: work.title || 'Untitled',
                            authors: (work.authorships || [])
                                .slice(0, 3)
                                .map((a: any) => a.author?.display_name || 'Unknown')
                                .filter(Boolean),
                            year: work.publication_year,
                            citationCount: work.cited_by_count,
                            doi,
                            arxivId
                        };
                    });

                // Cache the results
                this.searchCache.set(cacheKey, { results, timestamp: Date.now() });
                return results;
            }
        } catch (error: any) {
            if (error.code !== 'ECONNABORTED' && error.name !== 'CanceledError') {
                console.warn('Citation search failed:', error.message);
            }
        }

        return [];
    }

    // Get comment prefix based on language
    private getCommentPrefix(languageId: string): string {
        const commentPrefixes: { [key: string]: string } = {
            // Hash-style comments
            'python': '#',
            'ruby': '#',
            'perl': '#',
            'shellscript': '#',
            'bash': '#',
            'yaml': '#',
            'dockerfile': '#',
            'makefile': '#',
            'r': '#',
            'julia': '#',
            'powershell': '#',
            'coffeescript': '#',
            // Double-slash comments
            'javascript': '//',
            'typescript': '//',
            'javascriptreact': '//',
            'typescriptreact': '//',
            'java': '//',
            'c': '//',
            'cpp': '//',
            'csharp': '//',
            'go': '//',
            'rust': '//',
            'swift': '//',
            'kotlin': '//',
            'scala': '//',
            'dart': '//',
            'php': '//',
            'groovy': '//',
            // Percent comments
            'latex': '%',
            'tex': '%',
            'matlab': '%',
            'erlang': '%',
            // Semicolon comments
            'lisp': ';',
            'clojure': ';',
            'scheme': ';',
            'asm': ';',
            // Double-dash comments
            'sql': '--',
            'lua': '--',
            'haskell': '--',
            'ada': '--',
            // HTML-style
            'html': '<!--',
            'xml': '<!--',
            'markdown': '<!--',
            // Other
            'vim': '"',
            'plaintext': '#',
        };

        return commentPrefixes[languageId] || '//';
    }

    private createCompletionItem(
        result: SearchResult,
        index: number,
        replaceRange: vscode.Range,
        query: string,
        commentPrefix: string
    ): vscode.CompletionItem {
        // Create display title (truncated if needed)
        const displayTitle = result.title.length > 55
            ? result.title.substring(0, 52) + '...'
            : result.title;

        const item = new vscode.CompletionItem(displayTitle, vscode.CompletionItemKind.Reference);

        // Format authors for detail line
        const authorsText = result.authors.length > 2
            ? `${result.authors.slice(0, 2).join(', ')} et al.`
            : result.authors.join(', ') || 'Unknown authors';

        // Build detail string with year and citations
        const metaParts: string[] = [];
        if (result.year) metaParts.push(String(result.year));
        if (result.citationCount && result.citationCount > 0) {
            metaParts.push(`${result.citationCount.toLocaleString()} citations`);
        }

        item.detail = `${authorsText}${metaParts.length ? ' · ' + metaParts.join(' · ') : ''}`;

        // Build rich documentation
        const doc = new vscode.MarkdownString();
        doc.appendMarkdown(`**${result.title}**\n\n`);
        doc.appendMarkdown(`**Authors:** ${result.authors.join(', ') || 'Unknown'}\n\n`);
        if (result.year) doc.appendMarkdown(`**Year:** ${result.year}\n\n`);
        if (result.citationCount !== undefined) {
            doc.appendMarkdown(`**Citations:** ${result.citationCount.toLocaleString()}\n\n`);
        }
        if (result.arxivId) doc.appendMarkdown(`**arXiv:** ${result.arxivId}\n\n`);
        if (result.doi) doc.appendMarkdown(`**DOI:** ${result.doi}\n\n`);
        item.documentation = doc;

        // Determine citation format to insert
        // Format: Two lines - title on first line, identifier on second
        let identifier: string;
        if (result.arxivId) {
            identifier = `arxiv:${result.arxivId}`;
        } else if (result.doi) {
            identifier = `doi:${result.doi}`;
        } else {
            identifier = `openalex:${result.id}`;
        }

        // Clean title for inline display (remove quotes, limit length)
        const cleanTitle = result.title
            .replace(/"/g, "'")
            .substring(0, 100);
        const titleSuffix = result.title.length > 100 ? '...' : '';

        // Format: Two lines with language-appropriate comment prefix
        // Line 1: # "Paper Title"
        // Line 2: # arxiv:1234.5678
        // Handle HTML-style comments differently (need closing tag)
        let citation: string;
        if (commentPrefix === '<!--') {
            citation = `<!-- "${cleanTitle}${titleSuffix}" -->\n<!-- ${identifier} -->`;
        } else {
            citation = `${commentPrefix} "${cleanTitle}${titleSuffix}"\n${commentPrefix} ${identifier}`;
        }

        // Use TextEdit to replace the entire trigger pattern with the citation
        item.textEdit = vscode.TextEdit.replace(replaceRange, citation);

        // Sort order - keep API relevance order
        item.sortText = String(index).padStart(4, '0');

        // Preselect first item
        item.preselect = index === 0;

        // Filter text - make sure item stays visible while typing
        // Include both query and title to handle multi-word searches
        item.filterText = this.buildFilterText(query, result.title);

        return item;
    }

    clearCache(): void {
        this.searchCache.clear();
    }
}
