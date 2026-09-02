/* ===================== ROOT RENDER ===================== */
function render(){
  if(state.view==='print-only'){
    const insp = inspectionById(state.currentInspectionId);
    document.getElementById('app').innerHTML = insp
      ? `<div class="print-only-wrap">${renderReportBody(insp, '')}</div>`
      : '<div style="padding:60px 20px;text-align:center;color:#c0392b;font-family:sans-serif;">Report not found</div>';
    return;
  }
  let html = '';
  if(state.view==='forgot-password'){
    html = renderForgotPassword();
  } else if(state.view==='reset-password'){
    html = renderResetPassword();
  } else if(!state.session || state.view==='login'){
    html = renderLogin();
  } else if(state.session.role==='admin'){
    let content = '';
    if(state.view==='admin-properties') content = renderAdminProperties();
    else if(state.view==='admin-inspectors') content = renderAdminInspectors();
    else if(state.view==='admin-assignments') content = renderAdminAssignments();
    else if(state.view==='admin-inspections') content = renderAdminInspections();
    else if(state.view==='admin-report') content = renderAdminReport();
    else if(state.view==='admin-standards') content = renderAdminStandards();
    else if(state.view==='admin-documents') content = renderAdminDocuments();
    else if(state.view==='admin-settings') content = renderAdminSettings();
    else content = renderAdminOverview();
    html = renderAdminShell(content);
  } else if(state.session.role==='hotel'){
    html = renderHotelShell(state.view==='hotel-report' ? renderHotelReportDetail() : renderHotelReports());
  } else {
    if(state.view==='inspector-inspect') html = renderInspectorInspect();
    else if(state.view==='inspector-sign') html = renderInspectorSign();
    else if(state.view==='inspector-report') html = renderInspectorReport();
    else if(state.view==='inspector-standards') html = renderInspectorShell(renderStandardsDocument("state.inspTab='profile';go('inspector-home')"));
    else html = renderInspectorHome();
  }
  document.getElementById('app').innerHTML = html;
  if(state.session && state.session.role==='inspector' && state.view==='inspector-sign'){
    setTimeout(initSigPad, 30);
  }
  if(state.adminSigModalInspId){
    setTimeout(initAdminSigPad, 30);
  }
}

/* ===================== INIT ===================== */
async function boot(){
  document.getElementById('app').innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#64748b;font-family:sans-serif;font-size:14px;">Loading THO Mystery Guest…</div>';
  try{
    await loadData();
  }catch(e){
    document.getElementById('app').innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#c0392b;font-family:sans-serif;font-size:14px;padding:20px;text-align:center;">Could not reach the server. Please check your connection and reload.</div>';
    console.error('boot failed', e);
    return;
  }
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang==='ar' ? 'rtl':'ltr';
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = window.location.pathname === '/reset-password' ? urlParams.get('token') : null;
  if(resetToken){
    state.view = 'reset-password';
    state.resetToken = resetToken;
  } else if(urlParams.get('printReport') && state.session){
    // Dedicated headless-render mode used by the server's PDF export (Puppeteer navigates here
    // with the same session cookie). Renders just the report card, no shell/nav, and flips
    // window.__printReady once charts have had time to paint so Puppeteer knows when to snapshot.
    const printId = urlParams.get('printReport');
    // Respect whichever language the admin/inspector had selected on screen when they clicked
    // Export PDF (see exportReportPdf()) -- this print-only page is a brand-new session that
    // otherwise defaults to state's initial 'ar', silently ignoring the on-screen toggle and
    // always producing an Arabic PDF even when someone explicitly switched to English first.
    const printLang = urlParams.get('lang');
    if(printLang === 'ar' || printLang === 'en'){
      state.lang = printLang;
      document.documentElement.lang = state.lang;
      document.documentElement.dir = state.lang==='ar' ? 'rtl':'ltr';
    }
    state.reportMode = 'detailed';
    try{ await loadInspectionDetail(printId); }catch(e){}
    state.currentInspectionId = printId;
    state.view = 'print-only';
    document.body.classList.add('print-mode');
    render();
    // Wait for charts to actually finish drawing (not a guessed delay -- see chartsRenderPromise
    // above) and for the (self-hosted) Material Symbols icon font to finish loading, before
    // telling Puppeteer it's safe to snapshot. A fixed timeout here previously raced Chart.js's
    // own async rendering on slower hardware: it was long enough in local testing but not
    // reliably long enough on the production instance, which is exactly why this bug looked
    // intermittent -- correct locally, broken live.
    const fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    await Promise.all([fontsReady, chartsRenderPromise || Promise.resolve()]);
    // One more animation frame so the just-finished chart draw has actually been composited to
    // the screen before Puppeteer captures it.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Headless Chrome's Print-to-PDF pipeline has a real, reproducible bug with TWO similar
    // raster images (canvases, or even plain <img>s baked from them) on the same printed page:
    // whichever one is second consistently loses its text/fine detail in the exported PDF only
    // -- never on screen, never in a plain screenshot of the identical live DOM, and the baked
    // PNG file itself (saved to disk and opened directly) is provably correct pixel-for-pixel.
    // Converting each chart canvas to its own separate <img> was not enough to dodge this --
    // it's specifically about there being a *second* similar image on the page, canvas or not.
    // Real fix: merge every chart canvas inside a .charts-row into ONE combined image before
    // Puppeteer snapshots, so there is only ever one such image per page for this bug to affect.
    async function swapCanvasForImage(canvas, dataUrl, widthPx, heightPx){
      return new Promise(resolve => {
        const img = document.createElement('img');
        img.alt = '';
        img.style.width = widthPx ? widthPx + 'px' : '100%';
        img.style.height = heightPx ? heightPx + 'px' : 'auto';
        img.style.display = 'block';
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = dataUrl;
        canvas.replaceWith(img);
      });
    }
    const swapPromises = [];
    document.querySelectorAll('.charts-row').forEach(chartsRow => {
      const canvases = Array.from(chartsRow.querySelectorAll('canvas'));
      if(canvases.length === 0) return;
      if(canvases.length === 1){
        const c = canvases[0];
        const r = c.getBoundingClientRect();
        swapPromises.push(swapCanvasForImage(c, c.toDataURL('image/png'), r.width, r.height));
        return;
      }
      try{
        const dpr = window.devicePixelRatio || 1;
        const gap = 18;
        const rects = canvases.map(c => c.getBoundingClientRect());
        const totalW = rects.reduce((s, r) => s + r.width, 0) + gap * (canvases.length - 1);
        const maxH = Math.max(...rects.map(r => r.height));
        const merged = document.createElement('canvas');
        merged.width = Math.max(1, Math.round(totalW * dpr));
        merged.height = Math.max(1, Math.round(maxH * dpr));
        const mctx = merged.getContext('2d');
        mctx.scale(dpr, dpr);
        // canvases are in DOM order; the RTL grid shows the FIRST dom canvas on the right and
        // the SECOND on the left, so draw in reverse DOM order to keep the same visual
        // left-to-right arrangement once flattened into one plain (always-LTR-drawn) image.
        let x = 0;
        canvases.slice().reverse().forEach(c => {
          const r = c.getBoundingClientRect();
          mctx.drawImage(c, x, 0, r.width, r.height);
          x += r.width + gap;
        });
        const dataUrl = merged.toDataURL('image/png');
        const titles = Array.from(chartsRow.querySelectorAll('.chart-card h3')).map(h => h.textContent);
        const titleCells = titles.map(txt => `<div class="chart-card" style="padding-bottom:0;"><h3>${esc(txt)}</h3></div>`).join('');
        // The original .charts-row class forces `display:grid;grid-template-columns:1fr 1fr
        // !important` (a print-mode rule) -- that !important beats any inline style we could
        // set here, so it would otherwise force our two new children (the title row and the
        // image below it) to sit side-by-side as grid columns instead of stacking. Drop the
        // class so our own inline layout takes over cleanly instead of fighting it.
        chartsRow.classList.remove('charts-row');
        chartsRow.style.marginBottom = '22px';
        chartsRow.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(${canvases.length},1fr);gap:${gap}px;">${titleCells}</div>
          <div style="margin-top:4px;"><img alt="" style="width:100%;display:block;" src="${dataUrl}"></div>`;
        const mergedImg = chartsRow.querySelector('img');
        swapPromises.push(new Promise(resolve => {
          if(mergedImg.complete){ resolve(); return; }
          mergedImg.onload = () => resolve();
          mergedImg.onerror = () => resolve();
        }));
      }catch(e){ console.error('chart merge -> image conversion failed', e); }
    });
    // Any remaining lone canvas outside a .charts-row (the single-chart "summary" report mode).
    document.querySelectorAll('canvas').forEach(c => {
      const r = c.getBoundingClientRect();
      swapPromises.push(swapCanvasForImage(c, c.toDataURL('image/png'), r.width, r.height));
    });
    await Promise.all(swapPromises);
    // One more settle frame after the image swap so the new <img> elements are actually
    // composited before Puppeteer captures the PDF.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.__printReady = true;
    return;
  } else if(state.session){
    state.view = state.session.role==='admin' ? 'admin-overview'
      : state.session.role==='hotel' ? 'hotel-reports'
      : 'inspector-home';
  }
  render();
}
boot();
