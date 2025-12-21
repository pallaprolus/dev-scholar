# DevScholar 🎓

**Your Code, Connected to Knowledge.**

DevScholar automatically detects research paper references (arXiv, DOI, IEEE, Semantic Scholar) in your code comments and links them to the source. Hover to see abstracts, authors, and citations—or **preview the full PDF** directly inside VS Code!

![DevScholar Demo](https://github.com/pallaprolus/dev-scholar/raw/main/DevScholar.gif)

## ✨ Features

### 1. 🔍 Click-to-Cite (NEW in v0.5.0!)
Search and cite papers by name directly from your editor:
-   Type `#cite:`, `@cite:`, or `cite:` followed by your search query
-   Real-time dropdown shows matching papers from OpenAlex
-   Select a paper to insert a properly formatted citation
-   Language-aware comment prefixes (40+ languages supported)
-   Or use **Cmd+Shift+C** (Mac) / **Ctrl+Shift+C** (Windows) to open the search panel

```python
# Type: #cite:attention transformer
# Get:
# "Attention Is All You Need"
# arxiv:1706.03762
```

### 2. 🔗 Instant Link Detection
Automatically highlights paper IDs in your comments. Supported formats:
-   **arXiv**: `arxiv:1706.03762`, `[arxiv:1810.04805]`, or full URLs
-   **DOI**: `doi:10.1038/nature14539` or `https://doi.org/...`
-   **IEEE**: `ieee:726791` or Xplore URLs
-   **Semantic Scholar**: Full URLs (e.g., `semanticscholar.org/paper/...`)
-   **OpenAlex**: `openalex:W1234567890`

### 3. 📄 In-Editor PDF Preview
Click **"Preview PDF"** (CodeLens or Hover) to read the full paper without leaving your editor.
-   Uses a custom high-performance PDF renderer.
-   Works with arXiv, IEEE (open access), and DOI references (via OpenAlex fallback).
-   Preview PDF only shown when available (arXiv papers always have PDFs)

### 4. ℹ️ Rich Metadata Hover
Hover over any link to see:
-   Title & Authors
-   Abstract / Summary
-   Publication Date
-   Citation Count

### 5. 📚 Bibliography Management
-   **Copy BibTeX**: Right-click or use the command palette to copy the BibTeX citation for any paper.
-   **Export All**: Generate a full bibliography for all papers referenced in your current file.

## 🚀 Getting Started

1.  **Install** the extension.
2.  Open any code file.
3.  Add a comment with a paper reference:
    ```python
    # See transformer architecture: arxiv:1706.03762
    def attention(q, k, v): ...
    ```
4.  Hover over the ID or click "Preview PDF"!

## 🗺️ Roadmap

-   [x] **v0.4.0**: IEEE Support & Metadata Caching
-   [x] **v0.4.5**: Semantic Scholar Integration
-   [x] **v0.4.6**: Robust DOI PDF Preview
-   [x] **v0.5.0**: Click-to-Cite (search papers by name, auto-complete citations)
-   [ ] **Future**:
    -   Google Scholar Integration (Smart Search Fallback)
    -   Two-way Zotero Sync
    -   Local PDF Annotation

## 🤝 Contributing

Check out `examples/devscholar_showcase.py` to see various link formats in action!
Contributions are welcome on [GitHub](https://github.com/pallaprolus/dev-scholar).

---
**Enjoying DevScholar?** Please leave a review! ⭐
