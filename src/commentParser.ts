import * as vscode from 'vscode';

export interface PaperReference {
    id: string;
    type: 'arxiv' | 'doi' | 'semantic_scholar';
    lineNumber: number;
    columnNumber: number;
    rawText: string;
    context?: string;
    version?: string;  // For arXiv versioned papers like 2301.12345v2
}

interface PatternConfig {
    pattern: RegExp;
    type: PaperReference['type'];
    idGroup: number;
    versionGroup?: number;
}

export class CommentParser {
    // Comprehensive patterns for all supported reference formats
    private patterns: PatternConfig[] = [
        // arXiv URL formats: https://arxiv.org/abs/2301.12345 or /pdf/2301.12345v2
        {
            pattern: /(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?(?:\.pdf)?/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Direct arXiv ID: arxiv:2301.12345 or arXiv: 2301.12345v2
        {
            pattern: /(?:arxiv[:\s]+)(\d{4}\.\d{4,5})(v\d+)?/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Bracket notation: [arxiv:2301.12345]
        {
            pattern: /\[arxiv[:\s]*(\d{4}\.\d{4,5})(v\d+)?\]/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Implements/Based on format: Implements: 1605.08386
        {
            pattern: /(?:implements|based on|see|ref|paper)[:\s]+(\d{4}\.\d{4,5})(v\d+)?/gi,
            type: 'arxiv',
            idGroup: 1,
            versionGroup: 2
        },
        // Old arXiv format: hep-th/9901001
        {
            pattern: /(?:arxiv[:\s]+)?([a-z-]+\/\d{7})/gi,
            type: 'arxiv',
            idGroup: 1
        },
        // DOI URL: https://doi.org/10.1234/example
        {
            pattern: /(?:https?:\/\/)?(?:dx\.)?doi\.org\/(10\.\d{4,}\/[^\s,\]]+)/gi,
            type: 'doi',
            idGroup: 1
        },
        // Direct DOI: doi:10.1234/example or DOI: 10.1234/example
        {
            pattern: /(?:doi[:\s]+)(10\.\d{4,}\/[^\s,\]]+)/gi,
            type: 'doi',
            idGroup: 1
        },
        // Semantic Scholar Corpus ID: s2-cid:123456789 or S2CID: 123456789
        {
            pattern: /(?:s2-?cid|semantic[- ]?scholar)[:\s]+(\d+)/gi,
            type: 'semantic_scholar',
            idGroup: 1
        },
    ];

    // Comment patterns for different languages
    private commentPatterns = [
        /^\s*\/\//,           // JavaScript, TypeScript, C, C++, Java, Go, Rust
        /^\s*#/,              // Python, Ruby, Shell, YAML
        /^\s*\/\*/,           // Multi-line comment start
        /^\s*\*/,             // Multi-line comment continuation
        /^\s*--/,             // SQL, Haskell, Lua
        /^\s*;/,              // Assembly, Lisp, INI
        /^\s*%/,              // LaTeX, MATLAB
        /^\s*<!--/,           // HTML, XML
        /^\s*"""/,            // Python docstring
        /^\s*'''/,            // Python docstring
    ];

    async parseFile(document: vscode.TextDocument): Promise<PaperReference[]> {
        const papers: PaperReference[] = [];
        const seenIds = new Set<string>();

        for (let lineNum = 0; lineNum < document.lineCount; lineNum++) {
            const line = document.lineAt(lineNum);
            const text = line.text;

            if (!this.isCommentLine(text, document.languageId)) continue;

            // Extract context (surrounding comment text)
            const context = this.extractContext(document, lineNum);

            for (const patternConfig of this.patterns) {
                patternConfig.pattern.lastIndex = 0;
                let match;

                while ((match = patternConfig.pattern.exec(text)) !== null) {
                    const id = match[patternConfig.idGroup];
                    const version = patternConfig.versionGroup ? match[patternConfig.versionGroup] : undefined;
                    const uniqueKey = `${patternConfig.type}:${id}`;

                    if (!seenIds.has(uniqueKey)) {
                        seenIds.add(uniqueKey);
                        papers.push({
                            id,
                            type: patternConfig.type,
                            lineNumber: lineNum,
                            columnNumber: match.index,
                            rawText: match[0],
                            context,
                            version: version?.replace('v', '')
                        });
                    }
                }
            }
        }

        return papers;
    }

    // Parse a single line (useful for incremental updates)
    parseLine(text: string, lineNumber: number): PaperReference[] {
        const papers: PaperReference[] = [];

        for (const patternConfig of this.patterns) {
            patternConfig.pattern.lastIndex = 0;
            let match;

            while ((match = patternConfig.pattern.exec(text)) !== null) {
                const id = match[patternConfig.idGroup];
                const version = patternConfig.versionGroup ? match[patternConfig.versionGroup] : undefined;

                papers.push({
                    id,
                    type: patternConfig.type,
                    lineNumber,
                    columnNumber: match.index,
                    rawText: match[0],
                    version: version?.replace('v', '')
                });
            }
        }

        return papers;
    }

    private isCommentLine(text: string, languageId?: string): boolean {
        // Check against all comment patterns
        return this.commentPatterns.some(pattern => pattern.test(text));
    }

    private extractContext(document: vscode.TextDocument, lineNum: number): string {
        // Get surrounding comment lines for context
        const contextLines: string[] = [];
        const maxContext = 3;

        // Look backwards for context
        for (let i = Math.max(0, lineNum - maxContext); i < lineNum; i++) {
            const line = document.lineAt(i).text;
            if (this.isCommentLine(line)) {
                contextLines.push(this.stripCommentMarkers(line));
            }
        }

        // Add current line
        contextLines.push(this.stripCommentMarkers(document.lineAt(lineNum).text));

        // Look forward for context
        for (let i = lineNum + 1; i < Math.min(document.lineCount, lineNum + maxContext + 1); i++) {
            const line = document.lineAt(i).text;
            if (this.isCommentLine(line)) {
                contextLines.push(this.stripCommentMarkers(line));
            } else {
                break;
            }
        }

        return contextLines.join(' ').trim().substring(0, 500);
    }

    private stripCommentMarkers(text: string): string {
        return text
            .replace(/^\s*\/\/\s*/, '')
            .replace(/^\s*#\s*/, '')
            .replace(/^\s*\/\*\s*/, '')
            .replace(/\s*\*\/\s*$/, '')
            .replace(/^\s*\*\s*/, '')
            .replace(/^\s*--\s*/, '')
            .replace(/^\s*;\s*/, '')
            .replace(/^\s*%\s*/, '')
            .trim();
    }

    // Get range for a paper reference (for decorations/diagnostics)
    getReferenceRange(paper: PaperReference): vscode.Range {
        const startPos = new vscode.Position(paper.lineNumber, paper.columnNumber);
        const endPos = new vscode.Position(paper.lineNumber, paper.columnNumber + paper.rawText.length);
        return new vscode.Range(startPos, endPos);
    }
}
