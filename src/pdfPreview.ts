import * as vscode from 'vscode';
import axios from 'axios';
import { PaperMetadata } from './arxivClient';

export class PdfPreviewManager {
    private panels: Map<string, vscode.WebviewPanel> = new Map();

    constructor(private context: vscode.ExtensionContext) { }

    async preview(paper: PaperMetadata) {
        if (!paper.pdfUrl) {
            vscode.window.showErrorMessage(`No PDF URL available for paper: ${paper.title}`);
            return;
        }

        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Check if we already have a panel for this paper
        if (this.panels.has(paper.id)) {
            const panel = this.panels.get(paper.id);
            panel?.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'devScholarPdf',
            `Preview: ${paper.title}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: []
            }
        );

        this.panels.set(paper.id, panel);

        panel.onDidDispose(() => {
            this.panels.delete(paper.id);
        });

        // Show loading state
        panel.webview.html = this.getLoadingHtml(paper.title);

        try {
            // Fetch PDF data as ArrayBuffer
            const response = await axios.get(paper.pdfUrl, {
                responseType: 'arraybuffer',
                headers: {
                    'User-Agent': 'DevScholar/0.4.1 (VS Code Extension)'
                }
            });

            // Convert to Base64
            const pdfBase64 = Buffer.from(response.data).toString('base64');

            // Render viewer
            panel.webview.html = this.getViewerHtml(paper.title, pdfBase64);

        } catch (error: any) {
            panel.webview.html = this.getErrorHtml(paper.title, error.message);
        }
    }

    private getLoadingHtml(title: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                    .loader { border: 4px solid var(--vscode-editor-background); border-top: 4px solid var(--vscode-progressBar-background); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; }
                    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                </style>
            </head>
            <body>
                <div style="text-align: center">
                    <div class="loader"></div>
                    <p>Loading PDF for "${title}"...</p>
                </div>
            </body>
            </html>
        `;
    }

    private getErrorHtml(title: string, error: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <body style="font-family: sans-serif; padding: 20px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background);">
                <h2>Error Loading PDF</h2>
                <p>Could not load "${title}"</p>
                <p>Error: ${error}</p>
            </body>
            </html>
        `;
    }

    private getViewerHtml(title: string, pdfBase64: string): string {
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <style>
                    body { margin: 0; padding: 0; background-color: #525659; height: 100vh; display: flex; flex-direction: column; }
                    #toolbar { 
                        height: 32px; background-color: #323639; display: flex; align-items: center; padding: 0 10px; color: white; font-family: sans-serif; font-size: 13px;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.5); z-index: 10;
                    }
                    #container { flex: 1; overflow: auto; text-align: center; }
                    canvas { margin: 10px auto; box-shadow: 0 0 10px rgba(0,0,0,0.5); }
                    button { background: none; border: none; color: white; cursor: pointer; padding: 5px 10px; }
                    button:hover { background-color: rgba(255,255,255,0.1); }
                </style>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
                <script>
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                </script>
            </head>
            <body>
                <div id="toolbar">
                    <button id="prev" onclick="onPrevPage()">Previous</button>
                    <span id="page_num"></span> / <span id="page_count"></span>
                    <button id="next" onclick="onNextPage()">Next</button>
                    <span style="flex: 1"></span>
                    <button onclick="onZoomIn()">+</button>
                    <button onclick="onZoomOut()">-</button>
                </div>
                <div id="container"></div>

                <script>
                    const pdfData = atob("${pdfBase64}");
                    let pdfDoc = null;
                    let pageNum = 1;
                    let pageRendering = false;
                    let pageNumPending = null;
                    let scale = 1.5;
                    const container = document.getElementById('container');

                    // Load PDF
                    const loadingTask = pdfjsLib.getDocument({data: pdfData});
                    loadingTask.promise.then(function(pdf) {
                        pdfDoc = pdf;
                        document.getElementById('page_count').textContent = pdf.numPages;
                        renderPage(pageNum);
                    }, function (reason) {
                        console.error(reason);
                    });

                    function renderPage(num) {
                        pageRendering = true;
                        
                        pdfDoc.getPage(num).then(function(page) {
                            const viewport = page.getViewport({scale: scale});
                            
                            // Check if canvas already exists for this page or create new one
                            // Simple viewer: just clear container and render one page
                            container.innerHTML = ''; 
                            const canvas = document.createElement('canvas');
                            container.appendChild(canvas);

                            const context = canvas.getContext('2d');
                            canvas.height = viewport.height;
                            canvas.width = viewport.width;

                            const renderContext = {
                                canvasContext: context,
                                viewport: viewport
                            };
                            
                            const renderTask = page.render(renderContext);

                            renderTask.promise.then(function() {
                                pageRendering = false;
                                if (pageNumPending !== null) {
                                    renderPage(pageNumPending);
                                    pageNumPending = null;
                                }
                            });
                        });

                        document.getElementById('page_num').textContent = num;
                    }

                    function queueRenderPage(num) {
                        if (pageRendering) {
                            pageNumPending = num;
                        } else {
                            renderPage(num);
                        }
                    }

                    function onPrevPage() {
                        if (pageNum <= 1) return;
                        pageNum--;
                        queueRenderPage(pageNum);
                    }

                    function onNextPage() {
                        if (pageNum >= pdfDoc.numPages) return;
                        pageNum++;
                        queueRenderPage(pageNum);
                    }
                    
                    function onZoomIn() {
                        scale += 0.25;
                        renderPage(pageNum);
                    }
                    
                    function onZoomOut() {
                        if (scale <= 0.5) return;
                        scale -= 0.25;
                        renderPage(pageNum);
                    }
                </script>
            </body>
            </html>
        `;
    }
}
