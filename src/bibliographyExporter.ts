import { PaperReference } from './commentParser';
import { MetadataClient, PaperMetadata } from './arxivClient';

export class BibliographyExporter {
    private metadataClient: MetadataClient;

    constructor(metadataClient: MetadataClient) {
        this.metadataClient = metadataClient;
    }

    async export(papers: PaperReference[], format: string): Promise<string> {
        const metadata = await this.metadataClient.fetchMetadata(papers);

        switch (format.toLowerCase()) {
            case 'bibtex':
                return this.exportBibTeX(metadata);
            case 'apa':
                return this.exportAPA(metadata);
            case 'chicago':
                return this.exportChicago(metadata);
            case 'mla':
                return this.exportMLA(metadata);
            case 'harvard':
                return this.exportHarvard(metadata);
            default:
                return this.exportBibTeX(metadata);
        }
    }

    private exportBibTeX(papers: PaperMetadata[]): string {
        return papers.map(paper => {
            const key = this.generateBibKey(paper);
            const authors = this.formatBibTeXAuthors(paper.authors);
            const year = this.getYear(paper.published);

            const fields: string[] = [
                `  title = {${this.escapeBibTeX(paper.title)}}`
            ];

            if (authors) {
                fields.push(`  author = {${authors}}`);
            }

            fields.push(`  year = {${year}}`);

            if (paper.journal) {
                fields.push(`  journal = {${this.escapeBibTeX(paper.journal)}}`);
            } else if (paper.type === 'arxiv') {
                fields.push(`  journal = {arXiv preprint arXiv:${paper.id}}`);
            }

            if (paper.volume) {
                fields.push(`  volume = {${paper.volume}}`);
            }

            if (paper.pages) {
                fields.push(`  pages = {${paper.pages}}`);
            }

            if (paper.doi) {
                fields.push(`  doi = {${paper.doi}}`);
            }

            if (paper.arxivUrl) {
                fields.push(`  url = {${paper.arxivUrl}}`);
            } else if (paper.doiUrl) {
                fields.push(`  url = {${paper.doiUrl}}`);
            }

            if (paper.summary) {
                fields.push(`  abstract = {${this.escapeBibTeX(paper.summary.substring(0, 500))}}`);
            }

            const entryType = paper.journal ? 'article' : 'misc';
            return `@${entryType}{${key},\n${fields.join(',\n')}\n}`;
        }).join('\n\n');
    }

    private exportAPA(papers: PaperMetadata[]): string {
        return papers.map(paper => {
            const year = this.getYear(paper.published);
            const authors = this.formatAPAAuthors(paper.authors);

            let citation = `${authors} (${year}). ${paper.title}`;

            if (paper.journal) {
                citation += `. *${paper.journal}*`;
                if (paper.volume) {
                    citation += `, *${paper.volume}*`;
                }
                if (paper.pages) {
                    citation += `, ${paper.pages}`;
                }
            }

            if (paper.doi) {
                citation += `. https://doi.org/${paper.doi}`;
            } else if (paper.type === 'arxiv') {
                citation += `. arXiv:${paper.id}`;
            }

            return citation;
        }).join('\n\n');
    }

    private exportChicago(papers: PaperMetadata[]): string {
        return papers.map(paper => {
            const year = this.getYear(paper.published);
            const authors = this.formatChicagoAuthors(paper.authors);

            let citation = `${authors}. "${paper.title}."`;

            if (paper.journal) {
                citation += ` *${paper.journal}*`;
                if (paper.volume) {
                    citation += ` ${paper.volume}`;
                }
                if (paper.pages) {
                    citation += `: ${paper.pages}`;
                }
            }

            citation += ` (${year})`;

            if (paper.doi) {
                citation += `. https://doi.org/${paper.doi}`;
            } else if (paper.type === 'arxiv') {
                citation += `. arXiv:${paper.id}`;
            }

            return citation + '.';
        }).join('\n\n');
    }

    private exportMLA(papers: PaperMetadata[]): string {
        return papers.map(paper => {
            const year = this.getYear(paper.published);
            const authors = this.formatMLAAuthors(paper.authors);

            let citation = `${authors}. "${paper.title}."`;

            if (paper.journal) {
                citation += ` *${paper.journal}*`;
            }

            if (paper.volume) {
                citation += `, vol. ${paper.volume}`;
            }

            citation += `, ${year}`;

            if (paper.pages) {
                citation += `, pp. ${paper.pages}`;
            }

            if (paper.doi) {
                citation += `. doi:${paper.doi}`;
            }

            return citation + '.';
        }).join('\n\n');
    }

    private exportHarvard(papers: PaperMetadata[]): string {
        return papers.map(paper => {
            const year = this.getYear(paper.published);
            const authors = this.formatHarvardAuthors(paper.authors);

            let citation = `${authors} (${year}) '${paper.title}'`;

            if (paper.journal) {
                citation += `, *${paper.journal}*`;
            }

            if (paper.volume) {
                citation += `, ${paper.volume}`;
            }

            if (paper.pages) {
                citation += `, pp. ${paper.pages}`;
            }

            if (paper.doi) {
                citation += `. Available at: https://doi.org/${paper.doi}`;
            }

            return citation + '.';
        }).join('\n\n');
    }

    // ==================== Helper Methods ====================

    private generateBibKey(paper: PaperMetadata): string {
        const year = this.getYear(paper.published);
        const firstAuthor = paper.authors[0]?.split(' ').pop()?.toLowerCase() || 'unknown';
        // Clean the author name for use as key
        const cleanAuthor = firstAuthor.replace(/[^a-z]/gi, '');
        // Add first word of title to make more unique
        const titleWord = paper.title.split(' ')[0]?.toLowerCase().replace(/[^a-z]/gi, '') || '';
        return `${cleanAuthor}${year}${titleWord}`;
    }

    private getYear(published: string): number | string {
        if (!published) return 'n.d.';
        const year = new Date(published).getFullYear();
        return isNaN(year) ? 'n.d.' : year;
    }

    private escapeBibTeX(text: string): string {
        return text
            .replace(/\\/g, '\\textbackslash{}')
            .replace(/[&%$#_{}]/g, '\\$&')
            .replace(/~/g, '\\textasciitilde{}')
            .replace(/\^/g, '\\textasciicircum{}');
    }

    private formatBibTeXAuthors(authors: string[]): string {
        return authors.join(' and ');
    }

    private formatAPAAuthors(authors: string[]): string {
        if (authors.length === 0) return 'Unknown';
        if (authors.length === 1) return this.formatAPAAuthor(authors[0]);
        if (authors.length === 2) {
            return `${this.formatAPAAuthor(authors[0])} & ${this.formatAPAAuthor(authors[1])}`;
        }
        // More than 2 authors
        const formatted = authors.slice(0, 19).map(a => this.formatAPAAuthor(a));
        if (authors.length > 20) {
            return `${formatted.slice(0, 19).join(', ')}, ... ${this.formatAPAAuthor(authors[authors.length - 1])}`;
        }
        return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
    }

    private formatAPAAuthor(author: string): string {
        const parts = author.trim().split(' ');
        if (parts.length === 1) return parts[0];
        const lastName = parts.pop()!;
        const initials = parts.map(p => p[0] + '.').join(' ');
        return `${lastName}, ${initials}`;
    }

    private formatChicagoAuthors(authors: string[]): string {
        if (authors.length === 0) return 'Unknown';
        if (authors.length === 1) return authors[0];
        if (authors.length <= 3) {
            return authors.slice(0, -1).join(', ') + ', and ' + authors[authors.length - 1];
        }
        return `${authors[0]} et al.`;
    }

    private formatMLAAuthors(authors: string[]): string {
        if (authors.length === 0) return 'Unknown';
        if (authors.length === 1) {
            return this.formatMLAAuthor(authors[0]);
        }
        if (authors.length === 2) {
            return `${this.formatMLAAuthor(authors[0])}, and ${authors[1]}`;
        }
        return `${this.formatMLAAuthor(authors[0])}, et al.`;
    }

    private formatMLAAuthor(author: string): string {
        const parts = author.trim().split(' ');
        if (parts.length === 1) return parts[0];
        const lastName = parts.pop()!;
        return `${lastName}, ${parts.join(' ')}`;
    }

    private formatHarvardAuthors(authors: string[]): string {
        if (authors.length === 0) return 'Unknown';
        if (authors.length === 1) return this.formatHarvardAuthor(authors[0]);
        if (authors.length === 2) {
            return `${this.formatHarvardAuthor(authors[0])} and ${this.formatHarvardAuthor(authors[1])}`;
        }
        if (authors.length <= 3) {
            const formatted = authors.map(a => this.formatHarvardAuthor(a));
            return `${formatted.slice(0, -1).join(', ')} and ${formatted[formatted.length - 1]}`;
        }
        return `${this.formatHarvardAuthor(authors[0])} et al.`;
    }

    private formatHarvardAuthor(author: string): string {
        const parts = author.trim().split(' ');
        if (parts.length === 1) return parts[0];
        const lastName = parts.pop()!;
        const initials = parts.map(p => p[0] + '.').join('');
        return `${lastName}, ${initials}`;
    }
}
