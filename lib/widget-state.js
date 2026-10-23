function widgetState(element) {
  function visible(node) {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let current = node; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' ||
          style.visibility === 'collapse' || Number(style.opacity) === 0) return false;
    }
    return true;
  }
  const hasVisible = (selector) => Array.from(element.querySelectorAll(selector)).some(visible);
  if (!visible(element)) return 'hidden';
  if (hasVisible('[role="alert"], [data-testid*="error"], [class*="error-message"], [class*="errorMessage"]')) {
    return 'error';
  }
  if (hasVisible('.highcharts-no-data, [data-testid="no-data"]') ||
      /^(no data|no results|no data found|no data available)$/im.test(element.innerText)) {
    return 'no_data';
  }
  const title = Array.from(element.querySelectorAll('[role="heading"]')).filter((node) =>
    node.textContent.trim() === 'Study Environments with Visit Counts');
  if (title.length !== 1 || !visible(title[0])) return 'missing_title';
  // The observed loading-indicator test ID wraps the rendered chart too.
  if (hasVisible('.rdLoadingIndicator, [role="progressbar"], [aria-busy="true"]')) return 'loading';
  const charts = element.querySelectorAll('.highcharts-container svg.highcharts-root');
  if (charts.length !== 1 || !visible(charts[0])) return 'missing_chart';
  const points = Array.from(charts[0].querySelectorAll('.highcharts-series path.highcharts-point'));
  if (!points.some((point) => {
    if (!visible(point) || !point.getAttribute('d')) return false;
    const rect = point.getBoundingClientRect();
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  })) return 'missing_points';
  return 'ready';
}

export { widgetState };
