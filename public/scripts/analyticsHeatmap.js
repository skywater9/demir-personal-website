const currentLayoutVersion = 'homepage-v3';
const cellSize = 24;
const maxClicks = 20000;

// Partition exact viewport and page geometry so clicks from different layouts are never mixed.
export function groupHeatmapClicks(clicks) {
    const groups = new Map();
    for (const click of clicks) {
        const dimensions = [click.viewportWidth, click.viewportHeight, click.pageWidth, click.pageHeight];
        if (dimensions.some(value => !Number.isFinite(value) || value < 1 || value > 200000)
            || !Number.isFinite(click.documentX) || !Number.isFinite(click.documentY)
            || click.documentX < 0 || click.documentX > click.pageWidth
            || click.documentY < 0 || click.documentY > click.pageHeight) continue;
        const key = JSON.stringify([click.layoutVersion, ...dimensions]);
        if (!groups.has(key)) groups.set(key, {
            key, layoutVersion: click.layoutVersion,
            viewportWidth: click.viewportWidth, viewportHeight: click.viewportHeight,
            pageWidth: click.pageWidth, pageHeight: click.pageHeight, clicks: []
        });
        groups.get(key).clicks.push(click);
    }
    return [...groups.values()].sort((first, second) => second.clicks.length - first.clicks.length
        || first.key.localeCompare(second.key));
}

// Bin original document pixels directly, without scaling or adding scroll offsets a second time.
export function summarizeHeatmap(group) {
    const cells = new Map();
    const elements = new Map();
    for (const click of group.clicks) {
        const x = Math.floor(Math.min(click.documentX, group.pageWidth - 1) / cellSize) * cellSize;
        const y = Math.floor(Math.min(click.documentY, group.pageHeight - 1) / cellSize) * cellSize;
        const key = `${x}:${y}`;
        if (!cells.has(key)) cells.set(key, { x, y, count: 0 });
        cells.get(key).count += 1;
        const elementId = click.elementId || 'Untracked area';
        elements.set(elementId, (elements.get(elementId) || 0) + 1);
    }
    return {
        cells: [...cells.values()],
        peakCount: Math.max(0, ...[...cells.values()].map(cell => cell.count)),
        elementCounts: [...elements.entries()].sort((first, second) => second[1] - first[1])
    };
}

// Withhold oversized or mismatched overlays rather than presenting misleading coordinates.
export function checkPreviewGeometry(group, actualWidth, actualHeight) {
    if (group.layoutVersion !== currentLayoutVersion) return 'No page preview is available for this layout version. Counts are shown below.';
    if (group.viewportWidth > 5000 || group.viewportHeight > 12000 || group.pageWidth > 5000
        || group.pageHeight > 12000 || group.pageWidth * group.pageHeight > 16000000) {
        return 'This recorded page exceeds the preview size limit. Counts are shown below.';
    }
    if (Number.isFinite(actualWidth) && Number.isFinite(actualHeight)
        && (Math.abs(group.pageWidth - actualWidth) > 2 || Math.abs(group.pageHeight - actualHeight) > 2)) {
        return `Preview geometry differs from the recording (${actualWidth} × ${actualHeight} versus ${group.pageWidth} × ${group.pageHeight}). Overlay withheld; counts remain available.`;
    }
    return null;
}

// Static SVG remains visible with scripting disabled; a canvas would render fallback content instead.
export function createHeatmapOverlay(preview, group, summary) {
    const namespace = 'http://www.w3.org/2000/svg';
    const overlay = preview.createElementNS(namespace, 'svg');
    overlay.setAttribute('width', String(group.pageWidth));
    overlay.setAttribute('height', String(group.pageHeight));
    overlay.setAttribute('viewBox', `0 0 ${group.pageWidth} ${group.pageHeight}`);
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:absolute;left:0;top:0;z-index:2147483647;pointer-events:none;';
    for (const cell of summary.cells) {
        const rectangle = preview.createElementNS(namespace, 'rect');
        const intensity = cell.count / summary.peakCount;
        rectangle.setAttribute('x', String(cell.x));
        rectangle.setAttribute('y', String(cell.y));
        rectangle.setAttribute('width', String(Math.min(cellSize, group.pageWidth - cell.x)));
        rectangle.setAttribute('height', String(Math.min(cellSize, group.pageHeight - cell.y)));
        rectangle.setAttribute('fill', `hsl(${240 * (1 - intensity)}, 100%, 50%)`);
        rectangle.setAttribute('fill-opacity', '0.65');
        overlay.append(rectangle);
    }
    return overlay;
}

// Reuse trusted public markup while blocking scripts, resources, form submission, and navigation.
export function createInertPreview(html, css) {
    const preview = new DOMParser().parseFromString(html, 'text/html');
    preview.querySelectorAll('script, iframe, object, embed, link, base, meta, style, img, audio, video, source')
        .forEach(element => element.remove());
    for (const element of preview.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            if (/^on/i.test(attribute.name) || ['href', 'src', 'srcdoc', 'action', 'formaction', 'target', 'autofocus'].includes(attribute.name)) {
                element.removeAttribute(attribute.name);
            }
        }
        if (element.matches('a, button, input, select, textarea, [tabindex]')) element.setAttribute('tabindex', '-1');
    }
    const policy = preview.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
    const style = preview.createElement('style');
    style.textContent = `${css}\nbody { pointer-events: none; }`;
    preview.head.prepend(policy);
    preview.head.append(style);
    preview.body.setAttribute('inert', '');
    return `<!DOCTYPE html>\n${preview.documentElement.outerHTML}`;
}

// Share the authorized read path while keeping heatmap state independent of session selection.
export function createAnalyticsHeatmap({ elements, readAnalytics, showError, clearError }) {
    let authorized = false;
    let generation = 0;
    let busy = false;
    let clicks = new Map();
    let groups = [];
    let scannedBatches = 0;
    let nextCursor = null;
    let filters = null;
    let previewController = null;
    let previewGeneration = 0;
    let truncated = false;
    elements.heatmapTo.value = new Date().toISOString().slice(0, 10);
    elements.heatmapFrom.value = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

    // Render metadata as text rather than interpreting stored identifiers as HTML.
    function textElement(tag, value) {
        const element = document.createElement(tag);
        element.textContent = String(value);
        return element;
    }

    // Destroy the iframe and overlay when the identity, filters, or selected size changes.
    function clearPreview() {
        previewGeneration += 1;
        previewController?.abort();
        previewController = null;
        elements.heatmapPreview.replaceChildren();
        elements.heatmapPreviewNote.textContent = '';
    }

    // Forget coordinates immediately on sign-out and invalidate pending responses.
    function clear() {
        authorized = false;
        generation += 1;
        busy = false;
        clicks.clear();
        groups = [];
        scannedBatches = 0;
        nextCursor = null;
        filters = null;
        truncated = false;
        clearPreview();
        elements.heatmapPanel.hidden = true;
        elements.heatmapViewport.replaceChildren();
        elements.heatmapElementRows.replaceChildren();
        elements.heatmapStatus.textContent = '';
        elements.heatmapLegend.textContent = '';
        elements.heatmapMoreButton.hidden = true;
        elements.heatmapLoadButton.disabled = false;
    }

    // Show controls only after the dashboard verifies owner access.
    function setAuthorized(value) {
        if (!value) return clear();
        if (authorized) return;
        authorized = true;
        elements.heatmapPanel.hidden = false;
        elements.heatmapStatus.textContent = 'Choose upload dates and load the heatmap.';
    }

    // Label partial scans explicitly instead of inferring totals from the loaded pages.
    function updateStatus() {
        const completeness = truncated ? 'Display limit reached; narrow the dates to view all clicks.'
            : nextCursor ? 'Partial data: more batches remain. Load more to complete the scan.'
                : 'All batches in this upload-date range have been scanned.';
        elements.heatmapStatus.textContent = `${filters.from} to ${filters.to} UTC, ${filters.layoutVersion}: ${clicks.size} clicks loaded across ${groups.length} geometry groups; ${scannedBatches} batches scanned. ${completeness}`;
        elements.heatmapMoreButton.hidden = !nextCursor || truncated;
    }

    // Place static cells inside the recorded viewport so scrolling keeps both layers aligned.
    function drawOverlay(frame, group, summary, version) {
        if (!authorized || version !== previewGeneration) return;
        const preview = frame.contentDocument;
        if (!preview) return;
        const mismatch = checkPreviewGeometry(group, preview.documentElement.scrollWidth, preview.documentElement.scrollHeight);
        if (mismatch) {
            elements.heatmapPreviewNote.textContent = mismatch;
            return;
        }
        preview.body.append(createHeatmapOverlay(preview, group, summary));
        elements.heatmapPreviewNote.textContent = `${group.clicks.length} clicks in this exact geometry. Static homepage HUD, menu, and controls only; runtime menu, history, and results states are not replayed. The game canvas is blank because the preview runs no scripts. Counts include all recorded UI states.`;
    }

    // Load trusted source files without letting the preview execute scripts or request resources.
    async function renderSelectedGroup() {
        clearPreview();
        elements.heatmapElementRows.replaceChildren();
        elements.heatmapLegend.textContent = '';
        const group = groups.find(item => item.key === elements.heatmapViewport.value);
        if (!group || !authorized) return;
        const summary = summarizeHeatmap(group);
        for (const [elementId, count] of summary.elementCounts) {
            const row = document.createElement('tr');
            row.append(textElement('td', elementId), textElement('td', count));
            elements.heatmapElementRows.append(row);
        }
        elements.heatmapLegend.textContent = `Density uses ${cellSize} × ${cellSize} px cells. Blue → red means fewer → more clicks; peak: ${summary.peakCount} clicks per cell. Colors are relative to this group.`;
        const limitation = checkPreviewGeometry(group);
        if (limitation) {
            elements.heatmapPreviewNote.textContent = limitation;
            return;
        }
        const version = previewGeneration;
        const controller = new AbortController();
        previewController = controller;
        elements.heatmapPreviewNote.textContent = 'Loading inert page preview…';
        try {
            const responses = await Promise.all(['/index.html', '/style.css'].map(url => fetch(url, {
                credentials: 'omit', cache: 'no-store',
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
            })));
            if (responses.some(response => !response.ok)) throw new Error('The homepage preview could not be loaded.');
            const [html, css] = await Promise.all(responses.map(response => response.text()));
            if (!authorized || version !== previewGeneration) return;
            const frame = document.createElement('iframe');
            frame.setAttribute('sandbox', 'allow-same-origin');
            frame.setAttribute('referrerpolicy', 'no-referrer');
            frame.title = 'Homepage click heatmap; scroll to inspect the page. Element counts are listed below.';
            frame.style.width = `${group.viewportWidth}px`;
            frame.style.height = `${group.viewportHeight}px`;
            frame.addEventListener('load', () => drawOverlay(frame, group, summary, version), { once: true });
            frame.srcdoc = createInertPreview(html, css);
            elements.heatmapPreview.append(frame);
        } catch (error) {
            if (authorized && version === previewGeneration && error.name !== 'AbortError') {
                elements.heatmapPreviewNote.textContent = 'Preview unavailable. Element click counts remain available.';
                showError(error);
            }
        }
    }

    // Preserve the selected geometry after loading more batches when it is still present.
    function renderGroups() {
        const previous = elements.heatmapViewport.value;
        groups = groupHeatmapClicks([...clicks.values()]);
        elements.heatmapViewport.replaceChildren();
        for (const group of groups) {
            const option = textElement('option', `${group.viewportWidth} × ${group.viewportHeight} viewport / ${group.pageWidth} × ${group.pageHeight} page — ${group.clicks.length} clicks`);
            option.value = group.key;
            elements.heatmapViewport.append(option);
        }
        elements.heatmapViewport.disabled = !groups.length;
        elements.heatmapViewport.value = groups.some(group => group.key === previous) ? previous : (groups[0]?.key || '');
        updateStatus();
        void renderSelectedGroup();
    }

    // Fetch another bounded page only on request, keeping pagination and failures visible.
    async function load(reset = false) {
        if (!authorized || busy || (!reset && (!nextCursor || truncated))) return;
        if (reset) {
            generation += 1;
            clicks = new Map();
            scannedBatches = 0;
            nextCursor = null;
            truncated = false;
            filters = { view: 'heatmap', from: elements.heatmapFrom.value,
                to: elements.heatmapTo.value, layoutVersion: elements.heatmapLayout.value };
            groups = [];
            clearPreview();
            elements.heatmapElementRows.replaceChildren();
            elements.heatmapViewport.replaceChildren();
            elements.heatmapViewport.disabled = true;
            elements.heatmapMoreButton.hidden = true;
            elements.heatmapLegend.textContent = '';
        }
        const version = generation;
        busy = true;
        elements.heatmapLoadButton.disabled = true;
        elements.heatmapMoreButton.disabled = true;
        elements.heatmapStatus.textContent = `Loading batches… ${scannedBatches} scanned so far.`;
        clearError();
        try {
            const query = { ...filters };
            if (nextCursor) query.cursor = nextCursor;
            const result = await readAnalytics(query);
            if (!authorized || version !== generation) return;
            for (const click of result.clicks) {
                if (!clicks.has(click.eventId) && clicks.size >= maxClicks) {
                    truncated = true;
                    break;
                }
                clicks.set(click.eventId, click);
            }
            scannedBatches += result.scannedBatches;
            nextCursor = result.nextCursor;
            renderGroups();
        } catch (error) {
            if (authorized && version === generation && error.name !== 'AbortError') {
                elements.heatmapStatus.textContent = 'Heatmap scan failed. Displayed data may be incomplete; reload or retry.';
                showError(error);
            }
        } finally {
            if (authorized && version === generation) {
                busy = false;
                elements.heatmapLoadButton.disabled = false;
                elements.heatmapMoreButton.disabled = false;
            }
        }
    }

    // Apply filters deliberately rather than querying the database on every input change.
    function handleSubmit(event) {
        event.preventDefault();
        void load(true);
    }

    elements.heatmapForm.addEventListener('submit', handleSubmit);
    elements.heatmapMoreButton.addEventListener('click', () => load());
    elements.heatmapViewport.addEventListener('change', () => renderSelectedGroup());
    clear();
    return Object.freeze({ clear, setAuthorized });
}
