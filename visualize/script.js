let globalNodes = [];
let globalEdges = [];
let originalEdgeX = [], originalEdgeY = [], originalEdgeZ = [];
let currentScrollSpyHandler = null;
let isUpdating = false;
let currentThreshold = 0.80;
let lastHighlightedIndex = null;
let isAutoOrbit = true;
let orbitAngle = 0;
let activeSubHighlight = null;
let activeSearchIndices = null;
let hoveredIndex = null;

function getNodeTime(node) {
    if (node.metadata && node.metadata.date) {
        const d = new Date(node.metadata.date);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    if (node.mtime) {
        return node.mtime * 1000;
    }
    return new Date().getTime();
}

function formatDate(timestamp) {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return "YYYY-MM-DD";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Update Active Class inside Navigation Sidebar
function updateActiveDocItem(index) {
    const items = document.querySelectorAll('.legend-doc-item');
    items.forEach(item => {
        if (parseInt(item.dataset.index) === index) {
            item.classList.add('active');
            // Expand parent nodes if they are folded
            let parentGroup = item.closest('.legend-group');
            if (parentGroup && !parentGroup.classList.contains('active')) {
                parentGroup.classList.add('active');
            }
        } else {
            item.classList.remove('active');
        }
    });
}

let isRendering = false;

async function applyGraphVisualState() {
    const welcomeView = document.getElementById('welcome-view');
    if (!welcomeView || welcomeView.style.display === 'none') {
        return;
    }
    if (isRendering) return;
    isRendering = true;
    try {
        let baseOpacities = [];
        let baseSizes = [];

        const activeFocusIndex = (hoveredIndex !== null) ? hoveredIndex : lastHighlightedIndex;

        if (activeFocusIndex !== null) {
            const connectedIndices = new Set();
            globalEdges.forEach(edge => {
                const [sIdx, tIdx, score] = edge;
                if (score >= currentThreshold && (sIdx === activeFocusIndex || tIdx === activeFocusIndex)) {
                    const neighborIdx = (sIdx === activeFocusIndex ? tIdx : sIdx);
                    connectedIndices.add(neighborIdx);
                }
            });

            baseOpacities = globalNodes.map((n, i) => (i === activeFocusIndex || connectedIndices.has(i)) ? 1.0 : 0.05);
            baseSizes = globalNodes.map((n, i) => (i === activeFocusIndex || connectedIndices.has(i)) ? n.size * 1.5 : 2);
        } else if (activeSubHighlight !== null) {
            const [cat, sub] = activeSubHighlight.split(' :: ');
            baseOpacities = globalNodes.map(n => {
                return (n.category === cat && (n.subcategory === sub || n.subcategory.startsWith(sub + ' > '))) ? 1.0 : 0.08;
            });
            baseSizes = globalNodes.map(n => {
                const isMatch = n.category === cat && (n.subcategory === sub || n.subcategory.startsWith(sub + ' > '));
                return isMatch ? n.size : 1.5;
            });
        } else if (activeSearchIndices !== null) {
            baseOpacities = globalNodes.map((n, i) => activeSearchIndices.has(i) ? 1.0 : 0.05);
            baseSizes = globalNodes.map((n, i) => activeSearchIndices.has(i) ? n.size * 1.5 : 2);
        } else {
            baseOpacities = globalNodes.map(() => 0.9);
            baseSizes = globalNodes.map(n => n.size);
        }

        const edgeX = [], edgeY = [], edgeZ = [];
        globalEdges.forEach(edge => {
            const [sourceIdx, targetIdx, score] = edge;
            if (score >= currentThreshold) {
                const s = globalNodes[sourceIdx], t = globalNodes[targetIdx];
                if (s && t) {
                    edgeX.push(s.x, t.x, null); edgeY.push(s.y, t.y, null); edgeZ.push(s.z, t.z, null);
                }
            }
        });

        let finalEdgeX = edgeX;
        let finalEdgeY = edgeY;
        let finalEdgeZ = edgeZ;

        const theme = document.body.classList.contains('light-mode') ? 'light' : 'dark';
        let edgeColor = theme === 'light' ? 'rgba(70, 130, 220, 0.85)' : 'rgba(88, 166, 255, 0.15)';
        let edgeWidth = theme === 'light' ? 1.5 : 1;

        if (activeFocusIndex !== null) {
            const hX = [], hY = [], hZ = [];
            globalEdges.forEach(edge => {
                const [sIdx, tIdx, score] = edge;
                if (score >= currentThreshold && (sIdx === activeFocusIndex || tIdx === activeFocusIndex)) {
                    const s = globalNodes[sIdx], t = globalNodes[tIdx];
                    if (s && t) {
                        hX.push(s.x, t.x, null); hY.push(s.y, t.y, null); hZ.push(s.z, t.z, null);
                    }
                }
            });
            finalEdgeX = hX.length ? hX : [null];
            finalEdgeY = hY.length ? hY : [null];
            finalEdgeZ = hZ.length ? hZ : [null];
            edgeColor = 'rgba(58, 166, 255, 0.8)';
            edgeWidth = 3;
        } else if (activeSubHighlight !== null) {
            const [cat, sub] = activeSubHighlight.split(' :: ');
            const subCategoryNodeIndices = new Set();
            globalNodes.forEach((n, i) => {
                if (n.category === cat && (n.subcategory === sub || n.subcategory.startsWith(sub + ' > '))) {
                    subCategoryNodeIndices.add(i);
                }
            });
            const hX = [], hY = [], hZ = [];
            globalEdges.forEach(edge => {
                const [sIdx, tIdx, score] = edge;
                if (score >= currentThreshold && subCategoryNodeIndices.has(sIdx) && subCategoryNodeIndices.has(tIdx)) {
                    const s = globalNodes[sIdx], t = globalNodes[tIdx];
                    if (s && t) {
                        hX.push(s.x, t.x, null); hY.push(s.y, t.y, null); hZ.push(s.z, t.z, null);
                    }
                }
            });
            finalEdgeX = hX.length ? hX : [null];
            finalEdgeY = hY.length ? hY : [null];
            finalEdgeZ = hZ.length ? hZ : [null];
        } else if (activeSearchIndices !== null) {
            const hX = [], hY = [], hZ = [];
            globalEdges.forEach(edge => {
                const [sIdx, tIdx, score] = edge;
                if (score >= currentThreshold && activeSearchIndices.has(sIdx) && activeSearchIndices.has(tIdx)) {
                    const s = globalNodes[sIdx], t = globalNodes[tIdx];
                    if (s && t) {
                        hX.push(s.x, t.x, null); hY.push(s.y, t.y, null); hZ.push(s.z, t.z, null);
                    }
                }
            });
            finalEdgeX = hX.length ? hX : [null];
            finalEdgeY = hY.length ? hY : [null];
            finalEdgeZ = hZ.length ? hZ : [null];
        }

        await Plotly.restyle('plot', {
            'marker.opacity': [baseOpacities],
            'marker.size': [baseSizes]
        }, [1]);

        await Plotly.restyle('plot', {
            'x': [finalEdgeX],
            'y': [finalEdgeY],
            'z': [finalEdgeZ],
            'line.color': edgeColor,
            'line.width': edgeWidth
        }, [0]);
    } catch (err) {
        console.error("Visual state update error:", err);
    } finally {
        isRendering = false;
    }
}

// --- Color Space Utility Helpers ---
function hexToHls(hex) {
    hex = hex.replace(/^#/, '');
    let r = parseInt(hex.substring(0, 2), 16) / 255;
    let g = parseInt(hex.substring(2, 4), 16) / 255;
    let b = parseInt(hex.substring(4, 6), 16) / 255;

    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, l, s;
    l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, l, s };
}

function hlsToHex(h, l, s) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        let p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = x => {
        const hex = Math.round(x * 255).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
    };
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}



// --- Theme Management ---
function updatePlotlyTheme(theme) {
    const plotEl = document.getElementById('plot');
    if (!plotEl || !plotEl.data) return;

    const edgeColor = theme === 'light' ? 'rgba(70, 130, 220, 0.85)' : 'rgba(88, 166, 255, 0.15)';
    const nodeLineColor = theme === 'light' ? 'rgba(36, 41, 47, 0.4)' : 'rgba(201, 209, 217, 0.1)';
    const kwEdgeColor = theme === 'light' ? 'rgba(167, 139, 250, 0.3)' : 'rgba(167, 139, 250, 0.08)';

    const activeFocusIndex = (hoveredIndex !== null) ? hoveredIndex : lastHighlightedIndex;

    Plotly.restyle('plot', {
        'line.color': activeFocusIndex !== null ? (globalNodes[activeFocusIndex].is_keyword ? 'rgba(88, 166, 255, 0.15)' : 'rgba(58, 166, 255, 0.8)') : edgeColor,
        'marker.line.color': nodeLineColor
    }, [0, 1]).catch(() => { });

    Plotly.restyle('plot', {
        'line.color': activeFocusIndex !== null ? (globalNodes[activeFocusIndex].is_keyword ? 'rgba(167, 139, 250, 0.8)' : 'rgba(167, 139, 250, 0.6)') : kwEdgeColor,
    }, [2]).catch(() => { });
}

function markdownParse(text) {
    if (typeof marked !== 'undefined') {
        if (typeof marked.parse === 'function') {
            return marked.parse(text);
        } else if (typeof marked === 'function') {
            return marked(text);
        }
    }
    return text.replace(/\n/g, '<br>');
}

async function init() {
    try {
        // Theme initialization
        const themeToggle = document.getElementById('theme-toggle');
        const themeToggleMobile = document.getElementById('theme-toggle-mobile');
        let currentTheme = localStorage.getItem('theme') || 'dark';

        function applyTheme(theme) {
            if (theme === 'light') {
                document.body.classList.remove('dark-mode');
                document.body.classList.add('light-mode');
            } else {
                document.body.classList.remove('light-mode');
                document.body.classList.add('dark-mode');
            }
            updatePlotlyTheme(theme);
        }

        applyTheme(currentTheme);

        const handleThemeToggle = () => {
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('theme', 'light');
                applyTheme('light');
            } else {
                localStorage.setItem('theme', 'dark');
                applyTheme('dark');
            }
        };

        if (themeToggle) themeToggle.addEventListener('click', handleThemeToggle);
        if (themeToggleMobile) themeToggleMobile.addEventListener('click', handleThemeToggle);

        // --- Markdown Setup ---
        marked.use({
            hooks: {
                postprocess(html) {
                    return html.replace(/<table>/g, '<div class="table-wrapper"><table>')
                        .replace(/<\/table>/g, '</table></div>');
                }
            }
        });

        marked.setOptions({
            gfm: true,
            breaks: true,
            headerIds: false,
            mangle: false
        });
        const response = await fetch('/data/viz-data.json');
        const data = await response.json();
        globalNodes = data.nodes;
        globalEdges = data.edges;
        globalKeywordEdges = data.keyword_edges || [];

        globalNodes.forEach(node => {
            if (node.is_keyword) {
                node.category = 'Keyword';
                node.subcategory = 'Keyword';
                node.rootSubcategory = 'Keyword';
                return;
            }
            const rawPath = node.metadata.rel_path;
            const parts = rawPath.split('/').filter(p => p);
            let category = 'General';
            let subcategory = 'General';
            let rootSub = 'General';

            if (parts.length > 1) {
                category = parts[0];
                if (parts.length > 2) {
                    subcategory = parts.slice(1, -1).join(' > ');
                    rootSub = parts[1];
                } else {
                    subcategory = parts[0];
                    rootSub = parts[0];
                }
            }
            node.category = category;
            node.subcategory = subcategory;
            node.rootSubcategory = rootSub;
        });

        const rootSubsSet = new Set();
        globalNodes.forEach(node => {
            if (node.is_keyword) return;
            rootSubsSet.add(`${node.category}::${node.rootSubcategory}`);
        });
        const sortedRootSubs = Array.from(rootSubsSet).sort();
        const numRootSubs = sortedRootSubs.length;

        const rootSubToColor = {};
        sortedRootSubs.forEach((key, idx) => {
            const h = idx / numRootSubs;
            rootSubToColor[key] = { h, l: 0.60, s: 0.40 };
        });

        const rootToSubs = {};
        globalNodes.forEach(node => {
            if (node.is_keyword) return;
            const rKey = `${node.category}::${node.rootSubcategory}`;
            if (!rootToSubs[rKey]) {
                rootToSubs[rKey] = new Set();
            }
            rootToSubs[rKey].add(node.subcategory);
        });

        const subToColorMap = {};
        Object.keys(rootToSubs).forEach(rKey => {
            const baseColor = rootSubToColor[rKey];
            const subsInRoot = Array.from(rootToSubs[rKey]).sort();
            const numSubs = subsInRoot.length;

            subsInRoot.forEach((sub, subIdx) => {
                if (numSubs <= 1) {
                    subToColorMap[`${rKey}::${sub}`] = hlsToHex(baseColor.h, baseColor.l, baseColor.s);
                } else {
                    const lightnessOffset = -0.12 + (subIdx * 0.24 / (numSubs - 1));
                    const saturationOffset = -0.08 + (subIdx * 0.16 / (numSubs - 1));
                    const modulatedL = Math.max(0.45, Math.min(0.75, baseColor.l + lightnessOffset));
                    const modulatedS = Math.max(0.25, Math.min(0.60, baseColor.s + saturationOffset));
                    subToColorMap[`${rKey}::${sub}`] = hlsToHex(baseColor.h, modulatedL, modulatedS);
                }
            });
        });

        globalNodes.forEach(node => {
            if (node.is_keyword) return;
            const rKey = `${node.category}::${node.rootSubcategory}`;
            const subKey = `${rKey}::${node.subcategory}`;
            node.color = subToColorMap[subKey] || "#cccccc";
        });

        const legendContainer = document.getElementById('legend');
        legendContainer.innerHTML = '';

        const db = {};
        const catToColor = {};

        globalNodes.forEach((node, nodeIdx) => {
            if (node.is_keyword) return;
            const category = node.category;
            const subcategory = node.subcategory;

            if (!db[category]) {
                db[category] = {};
            }
            if (!db[category][subcategory]) {
                db[category][subcategory] = [];
            }
            db[category][subcategory].push({ node, index: nodeIdx });

            if (!catToColor[category]) {
                catToColor[category] = node.color || "#cccccc";
            }
        });

        // Helper function for subcategory color resolution
        function nodeColorForSubcategory(category, sub) {
            const nodesInSub = globalNodes.filter(n => n.category === category && n.subcategory === sub);
            if (nodesInSub.length > 0 && nodesInSub[0].color) {
                return nodesInSub[0].color;
            }
            return catToColor[category] || '#cccccc';
        }

        // Sort categories alphabetically
        const sortedCategories = Object.keys(db).sort((a, b) => a.localeCompare(b));

        // Render 2-level tree: Major Category Titles -> Subcategory Accordions
        sortedCategories.forEach(category => {
            // Major Category Section Header
            const sectionTitle = document.createElement('div');
            sectionTitle.className = 'legend-section-title';
            sectionTitle.textContent = category;
            legendContainer.appendChild(sectionTitle);

            const subcategories = db[category];
            const sortedSubcategories = Object.keys(subcategories).sort((a, b) => a.localeCompare(b));

            sortedSubcategories.forEach(sub => {
                const docs = subcategories[sub];
                const group = document.createElement('div');
                group.className = 'legend-group';
                group.classList.add('active'); // Keep expanded by default

                const header = document.createElement('div');
                header.className = 'legend-header';

                const colorBox = document.createElement('div');
                colorBox.className = 'legend-color';
                colorBox.style.background = nodeColorForSubcategory(category, sub);

                const label = document.createElement('span');
                label.className = 'legend-title';
                label.textContent = sub; // Subcategory accordion title (e.g. "os > linux")
                label.title = sub;

                const arrow = document.createElement('span');
                arrow.className = 'legend-arrow';
                arrow.textContent = '▼';

                // Left 70% Area (Color Box + Name)
                const leftArea = document.createElement('div');
                leftArea.className = 'legend-header-left legend-subcategory-trigger';
                leftArea.dataset.category = category;
                leftArea.dataset.subcategory = sub;
                leftArea.appendChild(colorBox);
                leftArea.appendChild(label);

                // Right 30% Area (Arrow icon button)
                const rightArea = document.createElement('div');
                rightArea.className = 'legend-header-right';
                rightArea.appendChild(arrow);

                header.appendChild(leftArea);
                header.appendChild(rightArea);

                // Container for documents directly under this subcategory
                const docContainer = document.createElement('div');
                docContainer.className = 'legend-sub-list';
                docContainer.style.gap = '2px';
                docContainer.style.marginTop = '2px';
                docContainer.style.width = '100%';
                docContainer.style.paddingLeft = '10px';

                // Sort documents alphabetically by title or filename
                const sortedDocs = [...docs].sort((a, b) => {
                    const titleA = a.node.metadata.title || a.node.metadata.filename || '';
                    const titleB = b.node.metadata.title || b.node.metadata.filename || '';
                    return titleA.localeCompare(titleB);
                });

                sortedDocs.forEach(({ node, index }) => {
                    const docItem = document.createElement('div');
                    docItem.className = 'legend-doc-item';
                    docItem.textContent = node.metadata.title || node.metadata.filename;
                    docItem.dataset.index = index;
                    docItem.addEventListener('click', (e) => {
                        e.stopPropagation();
                        highlightNode(index);
                    });
                    docItem.addEventListener('mouseenter', () => {
                        if (isUpdating) return;
                        hoveredIndex = index;
                        applyGraphVisualState();
                    });
                    docItem.addEventListener('mouseleave', () => {
                        if (isUpdating) return;
                        hoveredIndex = null;
                        applyGraphVisualState();
                    });
                    docContainer.appendChild(docItem);
                });

                const highlightKey = `${category} :: ${sub}`;

                // 1. Right area click: Toggle accordion open/close only, do not change graph highlight
                rightArea.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const isActive = group.classList.toggle('active');
                    arrow.textContent = isActive ? '▼' : '▶';
                });

                // 2. Left area click: Toggle graph highlight only, do not close/open accordion
                leftArea.addEventListener('click', function (e) {
                    e.stopPropagation();

                    if (activeSubHighlight === highlightKey) {
                        activeSubHighlight = null;
                    } else {
                        activeSubHighlight = highlightKey;
                        lastHighlightedIndex = null;
                        updateActiveDocItem(-1);
                    }
                    applyGraphVisualState();
                    updateActiveSubcategories();
                });

                group.appendChild(header);
                if (docs.length > 0) {
                    group.appendChild(docContainer);
                }
                legendContainer.appendChild(group);
            });
        });

        const nodeLineColor = currentTheme === 'light' ? 'rgba(36, 41, 47, 0.4)' : 'rgba(255, 255, 255, 0.1)';

        const nodeTrace = {
            x: globalNodes.map(n => n.x),
            y: globalNodes.map(n => n.y),
            z: globalNodes.map(n => n.z),
            text: globalNodes.map(n => n.metadata.title || n.metadata.filename),
            mode: 'markers',
            type: 'scatter3d',
            marker: {
                size: globalNodes.map(n => n.size),
                color: globalNodes.map(n => n.color),
                opacity: 0.9,
                line: { color: nodeLineColor, width: 0.5 }
            },
            hoverinfo: 'text'
        };

        const getFilteredEdges = (threshold) => {
            const edgeX = [], edgeY = [], edgeZ = [];
            globalEdges.forEach(edge => {
                const [sourceIdx, targetIdx, score] = edge;
                if (score >= threshold) {
                    const s = globalNodes[sourceIdx], t = globalNodes[targetIdx];
                    if (s && t) {
                        edgeX.push(s.x, t.x, null); edgeY.push(s.y, t.y, null); edgeZ.push(s.z, t.z, null);
                    }
                }
            });
            return { x: edgeX, y: edgeY, z: edgeZ };
        };

        const initialEdges = getFilteredEdges(currentThreshold);
        originalEdgeX = initialEdges.x;
        originalEdgeY = initialEdges.y;
        originalEdgeZ = initialEdges.z;

        const defaultEdgeColor = currentTheme === 'light' ? 'rgba(70, 130, 220, 0.85)' : 'rgba(88, 166, 255, 0.15)';

        const edgeTrace = {
            x: originalEdgeX, y: originalEdgeY, z: originalEdgeZ,
            mode: 'lines', type: 'scatter3d',
            line: { color: defaultEdgeColor, width: currentTheme === 'light' ? 1.5 : 1 },
            hoverinfo: 'none'
        };

        const layout = {
            paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
            margin: { t: 0, r: 0, b: 0, l: 0 },
            scene: {
                xaxis: { showgrid: false, zeroline: false, showticklabels: false, title: '' },
                yaxis: { showgrid: false, zeroline: false, showticklabels: false, title: '' },
                zaxis: { showgrid: false, zeroline: false, showticklabels: false, title: '' },
                camera: { eye: { x: 1.8, y: 1.8, z: 1.8 } }
            },
            showlegend: false
        };

        Plotly.newPlot('plot', [edgeTrace, nodeTrace], layout, { responsive: true, displayModeBar: false });

        const searchInput = document.getElementById('main-search-input');
        const searchResults = document.getElementById('main-search-results');
        const resultsList = document.getElementById('search-results-list');
        const aiContainer = document.getElementById('ai-answer-container');
        const aiBody = document.getElementById('ai-answer-body');
        const aiStatus = document.getElementById('ai-status');
        const aiSourcesList = document.getElementById('ai-sources-list');
        const submitBtn = document.getElementById('search-submit-btn');
        const ragToggleBtn = document.getElementById('rag-toggle-btn');
        
        let searchTimeout;
        let isRagMode = false;
        let ragAbortController = null;

        if (ragToggleBtn) {
            ragToggleBtn.addEventListener('click', function () {
                isRagMode = !isRagMode;
                this.classList.toggle('active', isRagMode);
                if (aiContainer) aiContainer.style.display = 'none';
                if (resultsList) resultsList.innerHTML = '';
                if (ragAbortController) {
                    ragAbortController.abort();
                    ragAbortController = null;
                }
            });
        }

        if (searchInput && searchResults) {
            searchInput.addEventListener('input', function () {
                clearTimeout(searchTimeout);
                const query = this.value.trim();

                if (!query) {
                    searchResults.classList.remove('active');
                    if (resultsList) resultsList.innerHTML = '';
                    if (aiContainer) aiContainer.style.display = 'none';
                    if (ragAbortController) {
                        ragAbortController.abort();
                        ragAbortController = null;
                    }
                    resetView();
                    return;
                }

                if (isRagMode) {
                    // RAG 모드일 때는 실시간 검색을 막음
                    return;
                }

                searchTimeout = setTimeout(async () => {
                    try {
                        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&k=10`);
                        if (data.status === 'success' && data.results.length > 0) {
                            displaySearchResults(data.results);
                        } else {
                            if (resultsList) {
                                resultsList.innerHTML = '<div style="padding: 15px; color: var(--text-secondary); font-size: 0.8rem; text-align: center;">검색 결과가 없습니다.</div>';
                            }
                            searchResults.classList.add('active');
                        }
                    } catch (err) {
                        console.error('Search error:', err);
                    }
                }, 300);
            });

            function displaySearchResults(results) {
                const targetList = resultsList || searchResults;
                targetList.innerHTML = '';
                searchResults.classList.add('active');

                const resultPaths = new Set(results.map(res => res.metadata.rel_path));
                const resultIndices = new Set();

                globalNodes.forEach((node, i) => {
                    if (resultPaths.has(node.metadata.rel_path)) {
                        resultIndices.add(i);
                    }
                });

                results.forEach(res => {
                    const item = document.createElement('div');
                    item.className = 'search-result-item';

                    const meta = res.metadata;
                    const score = res.rerank_score || res.score;
                    const title = meta.title || meta.filename;

                    item.innerHTML = `
                        <div class="result-title">
                            ${title} <span class="result-score-inline">(${score.toFixed(4)})</span>
                        </div>
                        <div class="result-snippet">${res.snippet || res.text}</div>
                    `;

                    item.onclick = () => {
                        const nodeIndex = globalNodes.findIndex(n => n.metadata.rel_path === meta.rel_path);
                        if (nodeIndex !== -1) {
                            highlightNode(nodeIndex);
                            searchResults.classList.remove('active');
                        } else {
                            alert('Graph에서 해당 문서를 찾을 수 없습니다.');
                        }
                    };

                    targetList.appendChild(item);
                });

                if (resultIndices.size > 0) {
                    activeSearchIndices = resultIndices;
                    applyGraphVisualState();
                }
            }

            const triggerSearch = () => {
                const query = searchInput.value.trim();
                if (!query) return;

                if (isRagMode) {
                    executeRAGSearch(query);
                } else {
                    executeNormalSearch(query);
                }
            };

            if (submitBtn) {
                submitBtn.addEventListener('click', triggerSearch);
            }

            searchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    triggerSearch();
                }
            });

            async function executeNormalSearch(query) {
                const targetList = resultsList || searchResults;
                if (aiContainer) aiContainer.style.display = 'none';
                searchResults.classList.add('active');
                targetList.innerHTML = '<div style="padding: 15px; color: var(--text-secondary); font-size: 0.8rem; text-align: center;">검색 중...</div>';

                try {
                    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&k=10`);
                    const data = await response.json();

                    if (data.status === 'success' && data.results.length > 0) {
                        displaySearchResults(data.results);
                    } else {
                        targetList.innerHTML = '<div style="padding: 15px; color: var(--text-secondary); font-size: 0.8rem; text-align: center;">검색 결과가 없습니다.</div>';
                    }
                } catch (err) {
                    console.error('Search error:', err);
                    targetList.innerHTML = '<div style="padding: 15px; color: var(--text-secondary); font-size: 0.8rem; text-align: center;">검색 에러가 발생했습니다.</div>';
                }
            }

            async function executeRAGSearch(query) {
                if (ragAbortController) {
                    ragAbortController.abort();
                }
                ragAbortController = new AbortController();
                const signal = ragAbortController.signal;

                searchResults.classList.add('active');
                if (aiContainer) aiContainer.style.display = 'block';
                if (aiBody) aiBody.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem; padding: 8px 0;">답변 생성 시작 중...</div>';
                if (aiStatus) {
                    aiStatus.textContent = '문서 검색 및 답변 생성 중...';
                    aiStatus.classList.add('loading');
                }
                if (aiSourcesList) aiSourcesList.innerHTML = '';
                if (resultsList) resultsList.innerHTML = '';

                const markdownParse = (text) => {
                    if (typeof marked !== 'undefined') {
                        if (typeof marked.parse === 'function') {
                            return marked.parse(text);
                        } else if (typeof marked === 'function') {
                            return marked(text);
                        }
                    }
                    return text;
                };

                try {
                    const response = await fetch(`/api/rag?q=${encodeURIComponent(query)}&k=5`, { signal });

                    if (!response.ok) {
                        throw new Error(`Server error: ${response.status}`);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder('utf-8');
                    let buffer = '';
                    let fullAnswerText = '';
                    let matchedMetadata = [];
                    let isStreamDone = false;

                    while (true) {
                        const { value, done } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            const cleanedLine = line.trim();
                            if (!cleanedLine) continue;

                            const dataIndex = cleanedLine.indexOf('data:');
                            if (dataIndex === -1) continue;

                            const dataStr = cleanedLine.substring(dataIndex + 5).trim();
                            if (dataStr === '[DONE]') {
                                isStreamDone = true;
                                break;
                            }

                            try {
                                const payload = JSON.parse(dataStr);
                                if (payload.type === 'metadata') {
                                    matchedMetadata = payload.results;
                                    displayRAGMetadata(matchedMetadata);
                                } else if (payload.type === 'content') {
                                    fullAnswerText += payload.text;
                                    if (aiBody) {
                                        try {
                                            aiBody.innerHTML = markdownParse(fullAnswerText);
                                            if (typeof renderMathInElement === 'function') {
                                                renderMathInElement(aiBody, {
                                                    delimiters: [
                                                        {left: '$$', right: '$$', display: true},
                                                        {left: '$', right: '$', display: false},
                                                        {left: '\\(', right: '\\)', display: false},
                                                        {left: '\\[', right: '\\]', display: true}
                                                    ],
                                                    throwOnError: false
                                                });
                                            }
                                        } catch (renderErr) {
                                            console.error('Render error:', renderErr);
                                            aiBody.innerHTML = `<div style="color: #ff6b6b; font-size:0.85rem; padding: 8px; border: 1px solid #ff6b6b; background: rgba(255, 107, 107, 0.05);">렌더링 오류: ${renderErr.message}</div>`;
                                            if (aiStatus) {
                                                aiStatus.textContent = '렌더링 오류';
                                                aiStatus.classList.remove('loading');
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('SSE JSON parse error:', e, dataStr);
                                if (aiBody) {
                                    aiBody.innerHTML = `<div style="color: #ff6b6b; font-size:0.85rem; padding: 8px; border: 1px solid #ff6b6b; background: rgba(255, 107, 107, 0.05); margin-top: 8px;">
                                        오류 발생: ${e.message}<br>
                                        <small style="color: var(--text-secondary);">Data: ${dataStr}</small>
                                    </div>`;
                                    if (aiStatus) {
                                        aiStatus.textContent = '오류 발생';
                                        aiStatus.classList.remove('loading');
                                    }
                                }
                            }
                        }
                        if (isStreamDone) break;
                    }

                    if (aiStatus && !signal.aborted) {
                        aiStatus.textContent = '답변 완료';
                        aiStatus.classList.remove('loading');
                    }
                    renderSourceChips(matchedMetadata);

                } catch (err) {
                    if (err.name === 'AbortError') {
                        console.log('RAG search aborted');
                        return;
                    }
                    console.error('RAG Search Error:', err);
                    if (aiStatus) {
                        aiStatus.textContent = '에러 발생';
                        aiStatus.classList.remove('loading');
                    }
                    if (aiBody) {
                        aiBody.innerHTML = `<div style="color: #ff6b6b; font-size: 0.85rem; padding: 8px; border: 1px solid #ff6b6b; background: rgba(255, 107, 107, 0.05);">답변 생성에 실패했습니다. (Error: ${err.message})</div>`;
                    }
                }
            }

            function displayRAGMetadata(results) {
                if (resultsList) resultsList.innerHTML = '';

                const resultPaths = new Set(results.map(res => res.metadata.rel_path));
                const resultIndices = new Set();

                globalNodes.forEach((node, i) => {
                    if (resultPaths.has(node.metadata.rel_path)) {
                        resultIndices.add(i);
                    }
                });

                if (resultIndices.size > 0) {
                    activeSearchIndices = resultIndices;
                    applyGraphVisualState();
                }

                results.forEach(res => {
                    const item = document.createElement('div');
                    item.className = 'search-result-item';
                    const meta = res.metadata;
                    const score = res.score;
                    const title = meta.title || meta.filename;

                    item.innerHTML = `
                        <div class="result-title">${title}</div>
                        <div class="result-snippet">${res.snippet || ''}</div>
                        <div class="result-meta">
                            <div class="result-score">Similarity: ${score.toFixed(4)}</div>
                        </div>
                    `;

                    item.onclick = () => {
                        const nodeIndex = globalNodes.findIndex(n => n.metadata.rel_path === meta.rel_path);
                        if (nodeIndex !== -1) {
                            highlightNode(nodeIndex);
                            searchResults.classList.remove('active');
                        } else {
                            alert('Graph에서 해당 문서를 찾을 수 없습니다.');
                        }
                    };

                    if (resultsList) resultsList.appendChild(item);
                });
            }

            function renderSourceChips(results) {
                if (!aiSourcesList) return;
                aiSourcesList.innerHTML = '';

                if (!results || results.length === 0) {
                    aiSourcesList.innerHTML = '<span style="font-size: 0.72rem; color: var(--text-secondary);">참조 문서 없음</span>';
                    return;
                }

                results.forEach(res => {
                    const meta = res.metadata;
                    const title = meta.title || meta.filename;
                    const chip = document.createElement('div');
                    chip.className = 'ai-source-chip';
                    chip.textContent = title;
                    chip.title = meta.rel_path;

                    chip.onclick = () => {
                        const nodeIndex = globalNodes.findIndex(n => n.metadata.rel_path === meta.rel_path);
                        if (nodeIndex !== -1) {
                            highlightNode(nodeIndex);
                            searchResults.classList.remove('active');
                        } else {
                            alert('Graph에서 해당 문서를 찾을 수 없습니다.');
                        }
                    };

                    aiSourcesList.appendChild(chip);
                });
            }

            document.addEventListener('click', (e) => {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target) && (!submitBtn || !submitBtn.contains(e.target))) {
                    searchResults.classList.remove('active');
                }
            });
        }

        const thresholdSlider = document.getElementById('threshold-slider');
        const thresholdVal = document.getElementById('threshold-val');

        thresholdSlider.addEventListener('input', function () {
            currentThreshold = parseFloat(this.value);
            thresholdVal.textContent = currentThreshold.toFixed(2);
            applyGraphVisualState();
        });

        const plotDiv = document.getElementById('plot');

        // --- Auto-Orbit Logic ---
        const orbitToggle = document.getElementById('orbit-toggle');
        let isUserInteracting = false;

        orbitToggle.addEventListener('change', function () {
            isAutoOrbit = this.checked;
            if (isAutoOrbit) requestAnimationFrame(animate);
        });

        plotDiv.addEventListener('mousedown', () => { isUserInteracting = true; });
        window.addEventListener('mouseup', () => { isUserInteracting = false; });

        let wheelActive = false;
        let wheelTimer;
        plotDiv.addEventListener('wheel', () => {
            wheelActive = true;
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => { wheelActive = false; }, 150);
        }, { passive: true });

        plotDiv.on('plotly_relayout', function (eventData) {
            const eye = eventData['scene.camera.eye'] || (eventData['scene.camera'] && eventData['scene.camera'].eye);
            if (eye) {
                orbitAngle = Math.atan2(eye.y, eye.x);
            }
        });

        let frameCount = 0;
        async function animate() {
            if (!isAutoOrbit || lastHighlightedIndex !== null || isUserInteracting) {
                if (isAutoOrbit) requestAnimationFrame(animate);
                return;
            }

            frameCount++;
            const throttle = wheelActive ? 5 : 2;
            if (frameCount % throttle !== 0) {
                requestAnimationFrame(animate);
                return;
            }

            const currentLayout = plotDiv.layout;
            if (!currentLayout?.scene?.camera?.eye) {
                requestAnimationFrame(animate);
                return;
            }

            const currentEye = currentLayout.scene.camera.eye;
            const radius = Math.sqrt(currentEye.x ** 2 + currentEye.y ** 2);

            orbitAngle += wheelActive ? 0.001 : 0.004;

            const x = radius * Math.cos(orbitAngle);
            const y = radius * Math.sin(orbitAngle);

            try {
                await Plotly.relayout('plot', {
                    'scene.camera.eye': { x: x, y: y, z: currentEye.z }
                });
            } catch (err) { }

            if (isAutoOrbit) requestAnimationFrame(animate);
        }

        setTimeout(() => { if (isAutoOrbit) requestAnimationFrame(animate); }, 1000);

        let plotlyClickFired = false;
        plotDiv.on('plotly_click', function (eventData) {
            plotlyClickFired = true;
            if (isUpdating) return;
            if (!eventData || !eventData.points || eventData.points.length === 0) { resetView(); return; }
            const p = eventData.points[0];
            if (p.fullData.mode !== 'markers') { resetView(); return; }

            // CurveNumber 1 is nodeTrace
            if (p.curveNumber === 1 && p.pointNumber !== undefined) {
                selectGraphNode(p.pointNumber);
            } else {
                resetView();
            }
        });

        // Plotly 3D does not fire plotly_click on empty space, so use native click
        plotDiv.addEventListener('click', function () {
            setTimeout(() => {
                if (!plotlyClickFired && lastHighlightedIndex !== null) {
                    resetView();
                }
                plotlyClickFired = false;
            }, 200);
        });

        document.getElementById('close-panel-btn').onclick = resetView;
        window.addEventListener('keydown', e => { if (e.key === 'Escape') resetView(); });

        const docCountEl = document.getElementById('doc-count');
        if (docCountEl) {
            docCountEl.textContent = `(${globalNodes.length})`;
        }

        const syncBtn = document.getElementById('sync-btn');
        syncBtn.addEventListener('click', async () => {
            syncBtn.disabled = true;
            syncBtn.classList.add('loading');
            syncBtn.innerHTML = 'Syncing...';

            const resetSyncButton = () => {
                syncBtn.disabled = false;
                syncBtn.classList.remove('loading');
                syncBtn.innerHTML = 'Sync';
            };

            try {
                const res = await fetch('/api/sync', { method: 'POST' });
                const result = await res.json();

                if (result.status === 'processing') {
                    const pollInterval = setInterval(async () => {
                        try {
                            const statusRes = await fetch('/api/sync/status');
                            const statusData = await statusRes.json();
                            if (statusData.status === 'idle') {
                                clearInterval(pollInterval);
                                location.reload();
                            } else if (statusData.status.startsWith('error')) {
                                clearInterval(pollInterval);
                                alert('Sync failed: ' + statusData.status);
                                resetSyncButton();
                            }
                        } catch (pollErr) {
                            console.error('Polling error:', pollErr);
                            clearInterval(pollInterval);
                            alert('An error occurred during sync monitoring.');
                            resetSyncButton();
                        }
                    }, 2000);
                } else if (result.status === 'success') {
                    location.reload();
                } else {
                    alert('Sync failed: ' + result.message);
                    resetSyncButton();
                }
            } catch (err) {
                console.error('Sync Error:', err);
                alert('An error occurred during sync.');
                resetSyncButton();
            }
        });

        // --- Mobile Interactions ---
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
        const sidebarBackdrop = document.getElementById('sidebar-backdrop');
        const sidebar = document.getElementById('sidebar');

        const closeSidebar = () => {
            if (sidebar && sidebarBackdrop) {
                sidebar.classList.remove('open');
                sidebarBackdrop.classList.remove('active');
            }
        };

        if (mobileMenuBtn && sidebar && sidebarBackdrop) {
            mobileMenuBtn.addEventListener('click', () => {
                sidebar.classList.add('open');
                sidebarBackdrop.classList.add('active');
            });
        }

        if (sidebarCloseBtn) sidebarCloseBtn.addEventListener('click', closeSidebar);
        if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeSidebar);

        // Controls Settings Panel Toggle (Mobile)
        const controlsToggleBtn = document.getElementById('controls-toggle-btn');
        const vizOverlayControls = document.getElementById('viz-overlay-controls');
        if (controlsToggleBtn && vizOverlayControls) {
            controlsToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vizOverlayControls.classList.toggle('open');
            });
            document.addEventListener('click', (e) => {
                if (!controlsToggleBtn.contains(e.target) && !vizOverlayControls.contains(e.target)) {
                    vizOverlayControls.classList.remove('open');
                }
            });
        }



        // Window Resize Event for Responsive Plotly Graph
        window.addEventListener('resize', () => {
            const plotDiv = document.getElementById('plot');
            if (plotDiv && Plotly) {
                Plotly.Plots.resize(plotDiv).catch(() => {});
            }
        });

        // Expose closeSidebar globally so it can be called in highlightNode
        window.closeMobileSidebar = closeSidebar;

    } catch (error) {
        console.error('Error:', error);
    }
}

async function highlightNode(index) {
    if (isUpdating && lastHighlightedIndex !== index) return;
    isUpdating = true;
    lastHighlightedIndex = index;
    try {
        // Close mobile sidebar drawer automatically on document click
        if (window.closeMobileSidebar) {
            window.closeMobileSidebar();
        }

        const item = globalNodes[index];
        if (!item) return;

        let mathBlocks = [];

        if (item.is_keyword) {
            document.getElementById('info-title').textContent = `# ${item.metadata.title}`;
            document.getElementById('info-path').textContent = "Keyword";
            document.getElementById('info-created').textContent = '-';
            document.getElementById('info-modified').textContent = '-';

            const connectedDocs = [];
            globalKeywordEdges.forEach(edge => {
                const [dIdx, kIdx] = edge;
                if (kIdx === index) {
                    const docNode = globalNodes[dIdx];
                    if (docNode) connectedDocs.push(docNode);
                }
            });

            const docListHtml = connectedDocs.map(d => `- ${d.metadata.title || d.metadata.filename}`).join('\n');
            const cleanExplanation = `### 키워드: ${item.metadata.title}\n\n이 단어는 다음 ${connectedDocs.length}개의 문서에서 빈번하게 등장하거나 중요 태그로 지정되어 있습니다. 아래 목록이나 그래프에서 연관된 문서를 클릭하여 지식 간의 흐름을 확인해 보세요.\n\n${docListHtml}`;

            const renderedHtml = marked.parse(cleanExplanation);
            document.getElementById('info-content').innerHTML = renderedHtml;
            document.getElementById('info-tags').innerHTML = '';
            document.getElementById('toc-sidebar').style.display = 'none';

            const relatedList = document.getElementById('related-list');
            relatedList.innerHTML = '';
            connectedDocs.forEach(doc => {
                const relEl = document.createElement('div');
                relEl.className = 'related-item';
                relEl.innerHTML = `
                    <div style="font-weight:600; color: var(--accent-color);">${doc.metadata.title || doc.metadata.filename}</div>
                `;
                relEl.onclick = (e) => {
                    e.stopPropagation();
                    highlightNode(doc.id);
                };
                relatedList.appendChild(relEl);
            });

            applyGraphVisualState();
            updateActiveDocItem(-1);

            document.getElementById('welcome-view').style.display = 'none';
            document.getElementById('doc-view').style.display = 'block';
            document.querySelector('.main-content').scrollTop = 0;
            document.getElementById('doc-view').scrollTop = 0;
            return;
        }

        document.getElementById('info-title').textContent = item.metadata.title || item.metadata.filename;
        const rawPath = item.metadata.rel_path;
        const lastSlash = rawPath.lastIndexOf('/');
        const cleanPath = lastSlash !== -1 ? rawPath.substring(0, lastSlash).replace(/\//g, ' > ') : '';
        document.getElementById('info-path').textContent = cleanPath;

        // Display Created and Modified dates
        let createdStr = '-';
        if (item.metadata && item.metadata.date) {
            createdStr = formatDate(item.metadata.date);
        } else if (item.mtime) {
            createdStr = formatDate(item.mtime * 1000);
        }
        document.getElementById('info-created').textContent = createdStr;

        let modifiedStr = '-';
        if (item.metadata && item.metadata.last_modified) {
            modifiedStr = formatDate(item.metadata.last_modified);
        } else if (item.mtime) {
            modifiedStr = formatDate(item.mtime * 1000);
        }
        document.getElementById('info-modified').textContent = modifiedStr;

        let processedContent = item.text;
        const docPath = item.metadata.rel_path;
        const docDir = docPath.substring(0, docPath.lastIndexOf('/') + 1);

        processedContent = processedContent.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
            if (src.startsWith('http') || src.startsWith('/')) return match;
            let fullSrc = "/posts/" + docDir + src;
            const parts = fullSrc.split('/');
            const stack = [];
            for (const part of parts) {
                if (part === '..') stack.pop();
                else if (part !== '.') stack.push(part);
            }
            return `![${alt}](${stack.join('/')})`;
        });

        processedContent = processedContent.replace(/^\[.+?\]\n+/gm, '');
        processedContent = processedContent.replace(/\$\$(.*?)\$\$|\\\[(.*?)\\\]/gs, (match) => {
            const id = `@@MATH_DISPLAY${mathBlocks.length}@@`;
            mathBlocks.push(match);
            return id;
        });
        processedContent = processedContent.replace(/\$(.*?)\$|\\\(.*?\\\)/g, (match) => {
            const id = `@@MATH_INLINE${mathBlocks.length}@@`;
            mathBlocks.push(match);
            return id;
        });

        let renderedHtml = markdownParse(processedContent);

        // Convert GFM alerts: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
        // Supports both multiline and inline formats under a unified regex, allowing bold tags around alert type
        renderedHtml = renderedHtml.replace(
            /<blockquote>\s*<p>(?:<strong>|<b>)?\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<\/strong>|<\/b>)?\s*(?:(?:&gt;|>)\s*)?([\s\S]*?)<\/p>\s*<\/blockquote>/gi,
            (match, type, content) => {
                const t = type.toUpperCase();
                const icons = { NOTE: '[INFO]', TIP: '[TIP]', IMPORTANT: '[IMPORTANT]', WARNING: '[WARNING]', CAUTION: '[CAUTION]' };
                return `<div class="gfm-alert gfm-alert-${t.toLowerCase()}"><p class="gfm-alert-title">${icons[t] || t}</p><p>${content.trim()}</p></div>`;
            }
        );

        mathBlocks.forEach((math, idx) => {
            const displayId = `@@MATH_DISPLAY${idx}@@`;
            const inlineId = `@@MATH_INLINE${idx}@@`;

            if (renderedHtml.includes(displayId)) {
                const cleanedMath = math.replace(/\$\$/g, '').replace(/\\\[|\\\]/g, '');
                let katexHtml = cleanedMath;
                try {
                    katexHtml = katex.renderToString(cleanedMath, { displayMode: true, throwOnError: false });
                } catch (err) { }
                renderedHtml = renderedHtml.replace(displayId, katexHtml);
            } else if (renderedHtml.includes(inlineId)) {
                const cleanedMath = math.replace(/\$/g, '').replace(/\\\(|\\\)/g, '');
                let katexHtml = cleanedMath;
                try {
                    katexHtml = katex.renderToString(cleanedMath, { displayMode: false, throwOnError: false });
                } catch (err) { }
                renderedHtml = renderedHtml.replace(inlineId, katexHtml);
            }
        });

        const infoContentEl = document.getElementById('info-content');
        infoContentEl.innerHTML = renderedHtml;

        renderMathInElement(infoContentEl, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false
        });

        // Generate Table of Contents (TOC) with Scroll Spy (Filter only H3 and H4)
        const headers = infoContentEl.querySelectorAll('h3, h4');
        const tocList = document.getElementById('toc-list');
        const tocSidebar = document.getElementById('toc-sidebar');
        const docView = document.getElementById('doc-view');

        // Clean up previous scroll listener
        if (docView && currentScrollSpyHandler) {
            docView.removeEventListener('scroll', currentScrollSpyHandler);
            currentScrollSpyHandler = null;
        }

        tocList.innerHTML = '';

        if (headers.length === 0) {
            tocSidebar.style.display = 'none';
        } else {
            tocSidebar.style.display = 'block';
            const headerElements = Array.from(headers);
            const tocItems = [];

            headerElements.forEach((header, idx) => {
                const headerId = `toc-section-${idx}`;
                header.id = headerId;

                const li = document.createElement('li');
                li.className = `toc-item toc-item-${header.tagName.toLowerCase()}`;
                li.textContent = header.textContent;

                li.addEventListener('click', (e) => {
                    e.preventDefault();
                    header.scrollIntoView({ behavior: 'smooth', block: 'start' });

                    document.querySelectorAll('.toc-item').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                });

                tocList.appendChild(li);
                tocItems.push(li);
            });

            // Notion-like Scroll Spy Implementation
            const handleScrollSpy = () => {
                let activeIndex = 0;
                const scrollContainerTop = docView.getBoundingClientRect().top;

                for (let i = 0; i < headerElements.length; i++) {
                    const rect = headerElements[i].getBoundingClientRect();
                    // Active when header is near the top of viewport (offset 170px)
                    if (rect.top - scrollContainerTop < 170) {
                        activeIndex = i;
                    } else {
                        break;
                    }
                }

                tocItems.forEach((li, idx) => {
                    if (idx === activeIndex) {
                        li.classList.add('active');
                    } else {
                        li.classList.remove('active');
                    }
                });
            };

            // Register scroll observer
            docView.addEventListener('scroll', handleScrollSpy);
            currentScrollSpyHandler = handleScrollSpy;

            // Trigger once initially to highlight the top section
            handleScrollSpy();
        }

        const tagsContainer = document.getElementById('info-tags');
        tagsContainer.innerHTML = '';
        if (item.metadata.tags) {
            item.metadata.tags.forEach(t => {
                const tagEl = document.createElement('span');
                tagEl.className = 'tag';
                tagEl.textContent = t;
                tagsContainer.appendChild(tagEl);
            });
        }

        const relatedList = document.getElementById('related-list');
        relatedList.innerHTML = '';

        const connectedEdges = globalEdges.filter(edge => {
            const [sIdx, tIdx, score] = edge;
            return score >= currentThreshold && (sIdx === index || tIdx === index);
        });

        connectedEdges.sort((a, b) => b[2] - a[2]);

        connectedEdges.forEach(edge => {
            const [sIdx, tIdx, score] = edge;
            const targetIdx = (sIdx === index) ? tIdx : sIdx;
            const targetNode = globalNodes[targetIdx];
            if (targetNode) {
                const relEl = document.createElement('div');
                relEl.className = 'related-item';
                relEl.innerHTML = `
                    <div style="font-weight:600; color: var(--accent-color);">${targetNode.metadata.title || targetNode.metadata.filename}</div>
                    <div style="font-size:0.7rem; color:var(--text-secondary); margin-top:2px;">Similarity: ${score.toFixed(4)}</div>
                `;
                relEl.onclick = (e) => {
                    e.stopPropagation();
                    highlightNode(targetNode.index !== undefined ? targetNode.index : targetIdx);
                };
                relatedList.appendChild(relEl);
            }
        });

        if (connectedEdges.length === 0) {
            relatedList.innerHTML = '<div style="font-size: 0.75rem; color: var(--text-secondary); font-style: italic;">연관 지식 링크가 존재하지 않음.</div>';
        }

        applyGraphVisualState();
        updateActiveDocItem(index);

        // Show Document Content View & Hide Welcome View
        document.getElementById('welcome-view').style.display = 'none';
        document.getElementById('doc-view').style.display = 'block';

        // Scroll containers to top
        document.querySelector('.main-content').scrollTop = 0;
        document.getElementById('doc-view').scrollTop = 0;

    } catch (err) {
        console.error('Highlight error:', err);
    } finally {
        isUpdating = false;
    }
}

let lastClickTime = 0;

function selectGraphNode(index) {
    if (isUpdating) return;
    isUpdating = true;
    try {
        const item = globalNodes[index];
        if (!item) return;

        const now = Date.now();
        // Second click on same node opens document detail (guard against Plotly double fire within 300ms)
        if (lastHighlightedIndex === index) {
            if (now - lastClickTime > 300) {
                isUpdating = false;
                highlightNode(index);
                return;
            }
            return;
        }

        // Clear active category highlight when selecting a single node
        activeSubHighlight = null;
        updateActiveSubcategories();

        lastHighlightedIndex = index;
        lastClickTime = now;
        applyGraphVisualState();
        updateActiveDocItem(index);
    } catch (err) {
        console.error('Select node error:', err);
    } finally {
        isUpdating = false;
    }
}

function updateActiveSubcategories() {
    const triggers = document.querySelectorAll('.legend-subcategory-trigger');
    if (activeSubHighlight !== null) {
        const [cat, sub] = activeSubHighlight.split(' :: ');
        triggers.forEach(tr => {
            const trCat = tr.dataset.category;
            const trSub = tr.dataset.subcategory;
            if (trCat === cat && (trSub === sub || trSub.startsWith(sub + ' > '))) {
                tr.classList.add('active');
            } else {
                tr.classList.remove('active');
            }
        });
    } else {
        triggers.forEach(tr => tr.classList.remove('active'));
    }
}

function resetView() {
    if (isUpdating) return;
    isUpdating = true;
    try {
        lastHighlightedIndex = null;
        activeSearchIndices = null;
        activeSubHighlight = null;
        updateActiveSubcategories();

        // Clear search values
        const searchInput = document.getElementById('main-search-input');
        const searchResults = document.getElementById('main-search-results');
        if (searchInput) searchInput.value = '';
        if (searchResults) {
            searchResults.innerHTML = '';
            searchResults.classList.remove('active');
        }

        // Show Welcome View & Hide Document Content View
        document.getElementById('welcome-view').style.display = 'block';
        document.getElementById('doc-view').style.display = 'none';

        // Clear Scroll Spy Handler
        const docView = document.getElementById('doc-view');
        if (docView && currentScrollSpyHandler) {
            docView.removeEventListener('scroll', currentScrollSpyHandler);
            currentScrollSpyHandler = null;
        }

        applyGraphVisualState();
        updateActiveDocItem(-1);
    } catch (err) {
        console.error('Reset view error:', err);
    } finally {
        isUpdating = false;
    }
}

document.addEventListener('DOMContentLoaded', init);
