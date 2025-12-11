import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import { PaperMetadata } from './arxivClient';

export class ZoteroSync {
    private baseUrl = 'https://api.zotero.org';
    private axiosInstance: AxiosInstance;

    constructor(context: vscode.ExtensionContext) {
        this.axiosInstance = axios.create({
            timeout: 10000,
            headers: {
                'User-Agent': 'DevScholar-Extension/0.2.0'
            }
        });
    }

    async syncPapers(papers: PaperMetadata[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('devscholar');
        const apiKey = config.get<string>('zoteroApiKey');
        const userId = config.get<string>('zoteroUserId');

        if (!apiKey || !userId) {
            throw new Error('Zotero API key and user ID not configured');
        }

        const headers = {
            'Zotero-API-Key': apiKey,
            'Content-Type': 'application/json'
        };

        let successCount = 0;
        let failCount = 0;

        for (const paper of papers) {
            try {
                // Map PaperMetadata to Zotero Item
                const zoteroItem = this.mapToZoteroItem(paper);

                // Post to Zotero
                // We use a simplified single-item creation for now. 
                // Zotero API supports batching (up to 50), but for clarity and error handling 
                // with mixed sources, one-by-one is safer for this initial version.
                await this.axiosInstance.post(
                    `${this.baseUrl}/users/${userId}/items`,
                    [zoteroItem], // API expects an array
                    { headers }
                );
                successCount++;
            } catch (error: any) {
                console.error(`Failed to sync paper ${paper.title}:`, error);
                failCount++;
                if (error.response?.status === 403) {
                    vscode.window.showErrorMessage('Zotero: Unauthorized. Check your API Key and User ID.');
                    return; // Stop on auth error
                }
            }
        }

        if (failCount > 0) {
            vscode.window.showWarningMessage(`Zotero Sync: ${successCount} synced, ${failCount} failed.`);
        } else {
            vscode.window.showInformationMessage(`Successfully synced ${successCount} papers to Zotero.`);
        }
    }

    private mapToZoteroItem(paper: PaperMetadata): any {
        // Defaults to journalArticle, fallback to preprint/report
        const itemType = paper.journal ? 'journalArticle' : 'preprint';

        const creators = paper.authors.map(name => {
            const parts = name.split(' ');
            return {
                creatorType: 'author',
                firstName: parts.slice(0, -1).join(' '),
                lastName: parts[parts.length - 1] || parts[0]
            };
        });

        return {
            itemType: itemType,
            title: paper.title,
            creators: creators,
            abstractNote: paper.summary,
            publicationTitle: paper.journal || 'arXiv',
            volume: paper.volume,
            pages: paper.pages,
            date: paper.published,
            url: paper.pdfUrl || paper.arxivUrl || paper.doiUrl,
            DOI: paper.doi,
            tags: paper.categories?.map(tag => ({ tag })) || [],
            extra: `DevScholar-Source: ${paper.type}\nDevScholar-ID: ${paper.id}`
        };
    }
}
