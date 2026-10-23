function journeyDom(command) {
  function visible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  const tiles = Array.from(document.querySelectorAll('[data-testid="answer-content"]')).filter(visible);
  let scroller = null;
  // Choose the outer dashboard scroller, never a table's nested row scroller.
  for (let node = tiles[0]?.parentElement; node; node = node.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(node).overflowY) && node.clientHeight > 100 &&
        node.scrollHeight > node.clientHeight + 2) {
      scroller = node;
    }
  }
  scroller ||= document.scrollingElement;
  if (!scroller) throw new Error('Dashboard scroll container unavailable.');
  if (command === 'top') scroller.scrollTo({ top: 0, behavior: 'instant' });
  if (command === 'next') {
    scroller.scrollTo({ top: scroller.scrollTop + Math.floor(scroller.clientHeight * 0.8), behavior: 'instant' });
  }
  const bounds = scroller === document.scrollingElement ?
    { top: 0, left: 0, right: innerWidth, bottom: innerHeight } : scroller.getBoundingClientRect();
  function inViewport(element) {
    const rect = element.getBoundingClientRect();
    return visible(element) && rect.bottom > Math.max(0, bounds.top) &&
      rect.top < Math.min(innerHeight, bounds.bottom) &&
      rect.right > Math.max(0, bounds.left) && rect.left < Math.min(innerWidth, bounds.right);
  }
  function pivotDataCells(tile) {
    return Array.from(tile.querySelectorAll(
      '.dx-pivotgrid .dx-area-data td, .dx-pivotgrid .dx-area-data-cell td'
    ));
  }
  function drawnPoint(point) {
    return visible(point) && !point.closest('.highcharts-legend, .highcharts-tooltip') &&
      (point.tagName.toLowerCase() !== 'path' || !!point.getAttribute('d')?.trim());
  }
  function state(tile) {
    const hasVisible = (selector) => Array.from(tile.querySelectorAll(selector)).some(visible);
    if (hasVisible('[role="alert"], [data-testid*="error"], [class*="error-message"], [class*="errorMessage"]')) {
      return 'error';
    }
    if (hasVisible('.highcharts-no-data, .ag-overlay-no-rows-center, [data-testid="no-data"]') ||
        /^(no data|no results|no data found|no data available)$/im.test(tile.innerText)) return 'no_data';
    if (hasVisible('.rdLoadingIndicator, [role="progressbar"], [aria-busy="true"], .ag-overlay-loading-center')) {
      return 'loading';
    }
    const chart = tile.querySelector('.highcharts-container svg.highcharts-root');
    if (chart) {
      return Array.from(chart.querySelectorAll('.highcharts-point')).some(drawnPoint) ?
        'ready_chart' : 'missing_points';
    }
    const grid = tile.querySelector('.ag-root[role="grid"], .ag-root[role="treegrid"]');
    if (grid) {
      return Array.from(grid.querySelectorAll('.ag-center-cols-container .ag-row .ag-cell')).some((cell) =>
        visible(cell) && cell.textContent.trim().length > 0
      ) ? 'ready_grid' : 'missing_rows';
    }
    const pivot = tile.querySelector('.dx-pivotgrid');
    if (pivot) {
      return pivotDataCells(tile).some((cell) =>
        visible(cell) && cell.textContent.trim().length > 0
      ) ? 'ready_pivot' : 'missing_cells';
    }
    return 'unsupported';
  }
  function renderSignals(tile) {
    const dataCells = pivotDataCells(tile);
    const chartPoints = Array.from(tile.querySelectorAll('.highcharts-container svg.highcharts-root .highcharts-point'));
    const seriesPoints = Array.from(tile.querySelectorAll(
      '.highcharts-container svg.highcharts-root .highcharts-series .highcharts-point'
    ));
    return {
      pivotCount: tile.querySelectorAll('.dx-pivotgrid').length,
      dataAreaCount: tile.querySelectorAll('.dx-pivotgrid .dx-area-data, .dx-pivotgrid .dx-area-data-cell').length,
      dataCellCount: dataCells.length,
      visibleDataCellCount: dataCells.filter(visible).length,
      populatedDataCellCount: dataCells.filter((cell) => cell.textContent.trim().length > 0).length,
      visiblePopulatedDataCellCount: dataCells.filter((cell) =>
        visible(cell) && cell.textContent.trim().length > 0).length,
      tableCellCount: tile.querySelectorAll('td').length,
      visibleTableCellCount: Array.from(tile.querySelectorAll('td')).filter(visible).length,
      chartCount: tile.querySelectorAll('.highcharts-container svg.highcharts-root').length,
      pointCount: chartPoints.length,
      visiblePointCount: chartPoints.filter(visible).length,
      seriesPointCount: seriesPoints.length,
      visibleSeriesPointCount: seriesPoints.filter(visible).length,
      drawnSeriesPointCount: seriesPoints.filter(drawnPoint).length,
    };
  }
  function pivotStructure(tile) {
    return Array.from(new Set(Array.from(tile.querySelectorAll(
      '.dx-pivotgrid, .dx-pivotgrid table, .dx-pivotgrid tr, .dx-pivotgrid td, .dx-pivotgrid div'
    )).map((node) => [
      node.tagName,
      ...Array.from(node.classList).filter((name) => /^dx-[a-z-]{1,60}$/.test(name)).sort(),
    ].join(' ')))).slice(0, 40);
  }
  function boundedStructure(tile) {
    const tags = ['div', 'span', 'p', 'section', 'article', 'svg', 'g', 'path', 'text',
      'canvas', 'iframe', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img',
      'button', 'a', 'input', 'label', 'h1', 'h2', 'h3', 'ul', 'li'];
    const roles = ['alert', 'status', 'progressbar', 'img', 'grid', 'treegrid',
      'row', 'cell', 'heading', 'button', 'table', 'presentation'];
    const walker = document.createTreeWalker(tile, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        return node.matches('[data-testid="dynamic-title-box"], script, style, template') ?
          NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    const counts = { svg: 0, canvas: 0, iframe: 0, table: 0, image: 0,
      highcharts: 0, grid: 0, pivot: 0, alert: 0, status: 0, progress: 0 };
    const selectors = {
      svg: 'svg', canvas: 'canvas', iframe: 'iframe', table: 'table', image: 'img',
      highcharts: '.highcharts-container', grid: '.ag-root', pivot: '.dx-pivotgrid',
      alert: '[role="alert"]', status: '[role="status"]',
      progress: '[role="progressbar"], .rdLoadingIndicator, [aria-busy="true"]',
    };
    let scanned = 0;
    let visibleCount = 0;
    let node;
    while (scanned < 200 && (node = walker.nextNode())) {
      scanned++;
      const isVisible = visible(node);
      if (isVisible) {
        visibleCount++;
        for (const key of Object.keys(counts)) if (node.matches(selectors[key])) counts[key]++;
      }
      if (nodes.length < 40) {
        let depth = 0;
        for (let parent = node.parentElement; parent && parent !== tile; parent = parent.parentElement) depth++;
        const tag = node.tagName.toLowerCase();
        const role = node.getAttribute('role');
        nodes.push({
          tag: tags.includes(tag) ? tag : 'other',
          role: role === null ? 'none' : roles.includes(role) ? role : 'other',
          depth: Math.min(depth, 32), visible: isVisible,
          hasDirectText: Array.from(node.childNodes).some((child) =>
            child.nodeType === Node.TEXT_NODE && child.textContent.trim().length > 0),
        });
      }
    }
    return { scanned, visibleCount, scanTruncated: !!walker.nextNode(),
      treeTruncated: scanned > nodes.length, counts, nodes };
  }
  return {
    selectedTabs: Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]'))
      .filter((tab) => visible(tab) && !tab.closest('[role="dialog"]'))
      .map((tab) => tab.textContent.replace(/\s+/g, ' ').trim()),
    scroll: {
      top: Math.round(scroller.scrollTop), height: scroller.clientHeight,
      total: scroller.scrollHeight,
      bottom: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2,
    },
    widgets: tiles.filter(inViewport).map((tile) => ({
      title: tile.querySelector('[data-testid="dynamic-title-box"] [role="heading"]')
        ?.textContent.replace(/\s+/g, ' ').trim() || '',
      state: state(tile),
      ...(command === 'diagnostic' ? {
        renderSignals: renderSignals(tile), pivotStructure: pivotStructure(tile),
      } : {}),
      ...(command === 'structure' ? { structure: boundedStructure(tile) } : {}),
    })),
  };
}

export { journeyDom };
