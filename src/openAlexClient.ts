import axios from 'axios';
import { PaperMetadata } from './arxivClient';

export class OpenAlexClient {
    private baseUrl = 'https://api.openalex.org/works';

    async fetchMetadata(id: string, type: string): Promise<PaperMetadata | null> {
        try {
            let url = '';
            // Construct URL based on ID type
            // OpenAlex supports: https://api.openalex.org/works/pmid:12345 or doi:10.1234/...
            if (type === 'openalex') {
                url = `${this.baseUrl}/${id}`;
            } else if (type === 'pmid') {
                url = `${this.baseUrl}/pmid:${id}`;
            } else if (type === 'doi') {
                url = `${this.baseUrl}/doi:${id}`;
            } else {
                // IEEE or others not directly supported by ID lookup in OpenAlex without search
                return null;
            }

            // Good practice to identify your script to OpenAlex
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'mailto:devscholar-extension@example.com' }
            });

            if (response.status === 200 && response.data) {
                return this.mapToMetadata(response.data, type, id);
            }
        } catch (error: any) {
            console.warn(`OpenAlex fetch failed for ${type}:${id}`, error.message);
        }
        return null;
    }

    async search(query: string): Promise<PaperMetadata | null> {
        try {
            const url = `${this.baseUrl}?search=${encodeURIComponent(query)}&per_page=1`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'mailto:devscholar-extension@example.com' }
            });

            if (response.status === 200 && response.data && response.data.results && response.data.results.length > 0) {
                // Use the first result
                const bestMatch = response.data.results[0];
                return this.mapToMetadata(bestMatch, 'openalex', bestMatch.id.replace('https://openalex.org/', ''));
            }
        } catch (error: any) {
            console.warn(`OpenAlex search failed for "${query}"`, error.message);
        }
        return null;
    }

    private mapToMetadata(data: any, originalType: string, originalId: string): PaperMetadata {
        const primaryLocation = data.primary_location || {};
        const source = primaryLocation.source || {};

        return {
            id: originalId,
            type: originalType as any,
            title: data.title,
            authors: data.authorships?.map((a: any) => a.author.display_name) || [],
            summary: data.abstract_inverted_index ? this.reconstructAbstract(data.abstract_inverted_index) : '',
            published: data.publication_date,
            journal: source.display_name,
            doi: data.doi,
            doiUrl: data.doi,
            pdfUrl: data.best_oa_location?.pdf_url || undefined,
            citationCount: data.cited_by_count,
            categories: data.keywords?.map((k: any) => k.display_name),
            fetchedAt: Date.now()
        };
    }

    // OpenAlex stores abstracts as an inverted index to save space. We must reconstruct it.
    private reconstructAbstract(invertedIndex: any): string {
        const wordMap: { [index: number]: string } = {};
        let maxIndex = 0;

        for (const word in invertedIndex) {
            const positions = invertedIndex[word];
            for (const pos of positions) {
                wordMap[pos] = word;
                if (pos > maxIndex) maxIndex = pos;
            }
        }

        const words: string[] = [];
        for (let i = 0; i <= maxIndex; i++) {
            if (wordMap[i]) {
                words.push(wordMap[i]);
            }
        }
        return words.join(' ');
    }
}
