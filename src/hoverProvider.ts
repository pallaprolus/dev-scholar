import * as vscode from 'vscode';
import { CommentParser, PaperReference } from './commentParser';
import { MetadataClient, PaperMetadata } from './arxivClient';

export class HoverProvider implements vscode.HoverProvider {
    private commentParser: CommentParser;
    private metadataClient: MetadataClient;

    constructor(metadataClient: MetadataClient) {
        this.metadataClient = metadataClient;
        this.commentParser = new CommentParser();
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const line = document.lineAt(position.line);
        const papers = this.commentParser.parseLine(line.text, position.line);

        if (papers.length === 0) return undefined;

        // Find the paper reference at cursor position
        const paperAtCursor = papers.find(paper => {
            const start = paper.columnNumber;
            const end = paper.columnNumber + paper.rawText.length;
            return position.character >= start && position.character <= end;
        });

        if (!paperAtCursor) return undefined;

        // Show loading indicator via status bar
        const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        statusItem.text = '$(sync~spin) Fetching paper metadata...';
        statusItem.show();

        try {
            const metadata = await this.metadataClient.fetchMetadata([paperAtCursor]);

            if (metadata.length > 0) {
                const markdown = this.formatHoverMarkdown(metadata[0], paperAtCursor);
                const range = this.commentParser.getReferenceRange(paperAtCursor);
                return new vscode.Hover(markdown, range);
            } else {
                // Show fallback hover with basic info
                return new vscode.Hover(this.formatFallbackHover(paperAtCursor));
            }
        } finally {
            statusItem.dispose();
        }
    }

    private formatHoverMarkdown(metadata: PaperMetadata, reference: PaperReference): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;
        markdown.supportHtml = true;

        // Title with type badge
        const typeBadge = this.getTypeBadge(metadata.type);
        markdown.appendMarkdown(`## ${typeBadge} ${this.escapeMarkdown(metadata.title)}\n\n`);

        // Authors (max 5, then "et al.")
        if (metadata.authors.length > 0) {
            const authorList = metadata.authors.length > 5
                ? `${metadata.authors.slice(0, 5).join(', ')} *et al.*`
                : metadata.authors.join(', ');
            markdown.appendMarkdown(`**Authors:** ${this.escapeMarkdown(authorList)}\n\n`);
        }

        // Publication info
        const pubInfo: string[] = [];
        if (metadata.published) {
            const year = new Date(metadata.published).getFullYear();
            if (!isNaN(year)) {
                pubInfo.push(`**Year:** ${year}`);
            }
        }
        if (metadata.journal) {
            pubInfo.push(`**Journal:** ${this.escapeMarkdown(metadata.journal)}`);
        }
        if (metadata.citationCount !== undefined) {
            pubInfo.push(`**Citations:** ${metadata.citationCount.toLocaleString()}`);
        }
        if (pubInfo.length > 0) {
            markdown.appendMarkdown(pubInfo.join(' | ') + '\n\n');
        }

        // Categories (for arXiv)
        if (metadata.categories && metadata.categories.length > 0) {
            const cats = metadata.categories.slice(0, 3).map(c => `\`${c}\``).join(' ');
            markdown.appendMarkdown(`**Categories:** ${cats}\n\n`);
        }

        // Abstract (truncated with smart word break)
        if (metadata.summary) {
            const summary = this.truncateSmart(metadata.summary, 300);
            markdown.appendMarkdown(`---\n\n`);
            markdown.appendMarkdown(`*${this.escapeMarkdown(summary)}*\n\n`);
        }

        // Links section
        markdown.appendMarkdown(`---\n\n`);
        const links: string[] = [];

        if (metadata.pdfUrl) {
            links.push(`[PDF](${metadata.pdfUrl})`);
        }
        if (metadata.arxivUrl) {
            links.push(`[arXiv](${metadata.arxivUrl})`);
        }
        if (metadata.doiUrl) {
            links.push(`[DOI](${metadata.doiUrl})`);
        }

        // Add copy commands
        const copyBibCommand = `command:devscholar.copyBibtex?${encodeURIComponent(JSON.stringify({ id: metadata.id, type: metadata.type }))}`;
        links.push(`[Copy BibTeX](${copyBibCommand})`);

        markdown.appendMarkdown(links.join(' | ') + '\n');

        // Version info if available
        if (reference.version) {
            markdown.appendMarkdown(`\n\n*Version: v${reference.version}*`);
        }

        return markdown;
    }

    private formatFallbackHover(paper: PaperReference): vscode.MarkdownString {
        const markdown = new vscode.MarkdownString();
        markdown.isTrusted = true;

        const typeBadge = this.getTypeBadge(paper.type);
        markdown.appendMarkdown(`## ${typeBadge} ${paper.id}\n\n`);
        markdown.appendMarkdown(`*Unable to fetch metadata. Paper may not exist or API is unavailable.*\n\n`);

        // Provide direct links anyway
        const links: string[] = [];
        if (paper.type === 'arxiv') {
            links.push(`[View on arXiv](https://arxiv.org/abs/${paper.id})`);
            links.push(`[PDF](https://arxiv.org/pdf/${paper.id}.pdf)`);
        } else if (paper.type === 'doi') {
            links.push(`[View DOI](https://doi.org/${paper.id})`);
        } else if (paper.type === 'semantic_scholar') {
            links.push(`[View on Semantic Scholar](https://www.semanticscholar.org/paper/${paper.id})`);
        }

        markdown.appendMarkdown(links.join(' | '));
        return markdown;
    }

    private getTypeBadge(type: string): string {
        switch (type) {
            case 'arxiv': return '📄';
            case 'doi': return '🔗';
            case 'semantic_scholar': return '🎓';
            default: return '📝';
        }
    }

    private truncateSmart(text: string, maxLength: number): string {
        if (text.length <= maxLength) return text;

        // Find last space before maxLength
        const truncated = text.substring(0, maxLength);
        const lastSpace = truncated.lastIndexOf(' ');

        if (lastSpace > maxLength * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }
        return truncated + '...';
    }

    private escapeMarkdown(text: string): string {
        // Escape special markdown characters
        return text.replace(/[*_`\[\]]/g, '\\$&');
    }
}
