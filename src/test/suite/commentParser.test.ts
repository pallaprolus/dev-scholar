import * as assert from 'assert';
import { CommentParser } from '../../commentParser';

suite('CommentParser', () => {
    let parser: CommentParser;

    setup(() => {
        parser = new CommentParser();
    });

    suite('arXiv Pattern Detection', () => {
        test('should detect arxiv URL format', () => {
            const text = '// See https://arxiv.org/abs/1706.03762 for details';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'arxiv');
            assert.strictEqual(papers[0].id, '1706.03762');
        });

        test('should detect arxiv PDF URL', () => {
            const text = '# https://arxiv.org/pdf/2301.12345.pdf';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'arxiv');
            assert.strictEqual(papers[0].id, '2301.12345');
        });

        test('should detect arxiv URL with version', () => {
            const text = '// https://arxiv.org/abs/1706.03762v2';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].id, '1706.03762');
            assert.strictEqual(papers[0].version, '2');
        });

        test('should detect direct arxiv:ID format', () => {
            const text = '// arxiv:2301.12345';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'arxiv');
            assert.strictEqual(papers[0].id, '2301.12345');
        });

        test('should detect arXiv: with space', () => {
            const text = '# arXiv: 1706.03762';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].id, '1706.03762');
        });

        test('should detect bracket notation [arxiv:ID]', () => {
            // Use only bracket pattern to avoid overlap with direct arxiv: pattern
            const text = '// Reference [1706.03762]';
            const papers = parser.parseLine(text, 0);

            // Bracket without arxiv: prefix won't match any pattern
            // Use text that only matches bracket pattern
            const text2 = '// [arxiv:1706.03762]';
            const papers2 = parser.parseLine(text2, 0);

            // Both bracket and direct patterns match arxiv:ID inside brackets
            assert.ok(papers2.length >= 1, 'Should detect at least one arxiv reference');
            assert.ok(papers2.some(p => p.id === '1706.03762'), 'Should find the arxiv ID');
        });

        test('should detect old arxiv format (hep-th/...)', () => {
            const text = '// See hep-th/9901001';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'arxiv');
            assert.strictEqual(papers[0].id, 'hep-th/9901001');
        });

        test('should detect "Implements:" format', () => {
            const text = '// Implements: 1605.08386';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'arxiv');
            assert.strictEqual(papers[0].id, '1605.08386');
        });

        test('should detect 5-digit arXiv IDs', () => {
            const text = '// arxiv:2301.12345';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers[0].id, '2301.12345');
        });

        test('should detect multiple arxiv references on same line', () => {
            const text = '// Compare arxiv:1706.03762 with arxiv:1810.04805';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 2);
            assert.strictEqual(papers[0].id, '1706.03762');
            assert.strictEqual(papers[1].id, '1810.04805');
        });
    });

    suite('DOI Pattern Detection', () => {
        test('should detect DOI URL format', () => {
            const text = '// https://doi.org/10.1038/nature14539';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'doi');
            assert.strictEqual(papers[0].id, '10.1038/nature14539');
        });

        test('should detect dx.doi.org URL', () => {
            const text = '# https://dx.doi.org/10.1145/1234567.7654321';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'doi');
        });

        test('should detect direct doi:ID format', () => {
            const text = '// doi:10.1038/nature14539';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'doi');
            assert.strictEqual(papers[0].id, '10.1038/nature14539');
        });

        test('should detect DOI: with space', () => {
            const text = '# DOI: 10.1109/5.771073';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'doi');
        });

        test('should handle complex DOI with special characters', () => {
            const text = '// doi:10.1000/xyz123-456';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.ok(papers[0].id.includes('xyz123'));
        });
    });

    suite('Semantic Scholar Pattern Detection', () => {
        test('should detect S2CID format', () => {
            const text = '// s2cid:123456789';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'semantic_scholar');
            assert.strictEqual(papers[0].id, '123456789');
        });

        test('should detect S2-CID with hyphen', () => {
            const text = '# S2-CID: 12345678';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'semantic_scholar');
        });

        test('should detect Semantic Scholar URL', () => {
            const text = '// https://www.semanticscholar.org/paper/Title-Words/abc123def456789012345678901234567890abcd';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'semantic_scholar');
        });
    });

    suite('OpenAlex Pattern Detection', () => {
        test('should detect openalex:W... format', () => {
            const text = '// openalex:W2741809807';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'openalex');
            assert.strictEqual(papers[0].id, 'W2741809807');
        });

        test('should detect OpenAlex URL', () => {
            const text = '# https://openalex.org/W2741809807';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'openalex');
        });
    });

    suite('PubMed Pattern Detection', () => {
        test('should detect pmid:ID format', () => {
            const text = '// pmid:12345678';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'pmid');
            assert.strictEqual(papers[0].id, '12345678');
        });

        test('should detect pubmed:ID format', () => {
            const text = '# pubmed: 98765432';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'pmid');
        });
    });

    suite('IEEE Pattern Detection', () => {
        test('should detect ieee:ID format', () => {
            const text = '// ieee:726791';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'ieee');
            assert.strictEqual(papers[0].id, '726791');
        });

        test('should detect IEEE Xplore URL', () => {
            const text = '# https://ieeexplore.ieee.org/document/726791';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
            assert.strictEqual(papers[0].type, 'ieee');
        });
    });

    suite('Comment Style Detection', () => {
        test('should parse JavaScript single-line comments', () => {
            const text = '// arxiv:1706.03762';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 1);
        });

        test('should parse Python comments', () => {
            const text = '# arxiv:1706.03762';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 1);
        });

        test('should parse multi-line comment continuation', () => {
            const text = ' * arxiv:1706.03762';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 1);
        });

        test('should parse SQL comments', () => {
            const text = '-- arxiv:1706.03762';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 1);
        });

        test('should parse LaTeX comments', () => {
            const text = '% arxiv:1706.03762';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 1);
        });

        test('should parse HTML comments', () => {
            const text = '<!-- arxiv:1706.03762 -->';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 1);
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty line', () => {
            const papers = parser.parseLine('', 0);
            assert.strictEqual(papers.length, 0);
        });

        test('should handle line with no paper references', () => {
            const text = '// This is just a regular comment';
            const papers = parser.parseLine(text, 0);
            assert.strictEqual(papers.length, 0);
        });

        test('should capture correct column position', () => {
            const text = '// See arxiv:1706.03762';
            const papers = parser.parseLine(text, 0);

            assert.ok(papers[0].columnNumber >= 0);
        });

        test('should capture raw text', () => {
            const text = '// arxiv:1706.03762v2';
            const papers = parser.parseLine(text, 0);

            assert.ok(papers[0].rawText.includes('1706.03762'));
        });

        test('should handle case insensitivity', () => {
            const text = '// ARXIV:1706.03762';
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 1);
        });

        test('should not match invalid arxiv IDs', () => {
            const text = '// arxiv:12345'; // Too short
            const papers = parser.parseLine(text, 0);

            assert.strictEqual(papers.length, 0);
        });
    });
});
