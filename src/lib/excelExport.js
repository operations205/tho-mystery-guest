// Builds an .xlsx workbook that mirrors the same report content the PDF export shows -- same
// hotel info, overall score/grade, mandatory compliance, per-category breakdown, and the full
// checklist with every item's answer and note -- styled with the THO navy/gold brand colors.
// This is NOT a pixel-for-pixel copy of the PDF: a spreadsheet is a grid of editable cells, the
// PDF is a fixed-layout document with photos and gradients, so the two mediums can never be
// visually identical. What matches 1:1 is the underlying data and structure.
const ExcelJS = require('exceljs');
const { catsForStandard, CLASS_META } = require('./standards');

const NAVY = 'FF050000';
const GOLD = 'FFF5B700';
const GOLD_SOFT = 'FFFFF3CD';
const WHITE = 'FFFFFFFF';
const GREEN = 'FF16803D';
const AMBER = 'FFB45309';
const RED = 'FFC0392B';

function scoreArgb(score) {
  if (score === null || score === undefined) return null;
  if (score >= 75) return GREEN;
  if (score >= 60) return AMBER;
  return RED;
}

function gradeFor(overall, hasCritical) {
  if (hasCritical) return { ar: 'حرج', en: 'Critical' };
  if (overall >= 90) return { ar: 'ممتاز', en: 'Excellent' };
  if (overall >= 75) return { ar: 'جيد جداً', en: 'Very Good' };
  if (overall >= 60) return { ar: 'يحتاج تحسين', en: 'Needs Improvement' };
  return { ar: 'حرج', en: 'Critical' };
}

// Mirrors the mandatory/critical-item compliance calc duplicated client-side in app-core.js's
// own computeScores() -- server-side standards.js computeScores() doesn't return it, so it's
// recomputed here directly from the raw answers the same way.
function mandatoryCompliance(cats, answers) {
  let critYes = 0, critAnswered = 0;
  cats.forEach(cat => {
    cat.items.forEach(item => {
      if (!item.crit) return;
      const a = answers[item.id];
      if (!a || !a.value) return;
      if (a.value === 'yes') { critYes++; critAnswered++; }
      else if (a.value === 'no') { critAnswered++; }
    });
  });
  return critAnswered > 0 ? Math.round((critYes / critAnswered) * 100) : null;
}

async function buildInspectionExcelBuffer({ row, hotel, answers, sc, lang }) {
  const cats = catsForStandard(row.standard_id);
  const isAr = lang !== 'en';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'THE HOTELIER OFFICE';
  wb.created = new Date();

  const hotelName = hotel ? (isAr ? hotel.name_ar : hotel.name_en) : row.property_name;
  const cityName = hotel ? (isAr ? hotel.city_ar : hotel.city_en) : (row.city || '');
  const grade = gradeFor(sc.overall, sc.criticalFails.length > 0);
  const mandatory = mandatoryCompliance(cats, answers);

  // ---- Sheet 1: Summary ----
  const sum = wb.addWorksheet(isAr ? 'ملخص التقرير' : 'Report Summary', {
    views: [{ rightToLeft: isAr }]
  });
  sum.columns = [{ width: 28 }, { width: 40 }];

  const titleRow = sum.addRow([isAr ? 'تقرير تقييم رحلة الضيف الخفي — THE HOTELIER OFFICE' : 'Mystery Guest Audit Report — THE HOTELIER OFFICE']);
  sum.mergeCells(titleRow.number, 1, titleRow.number, 2);
  titleRow.getCell(1).font = { bold: true, size: 15, color: { argb: WHITE } };
  titleRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titleRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
  titleRow.height = 26;
  sum.addRow([]);

  function addField(labelAr, labelEn, value) {
    const r = sum.addRow([isAr ? labelAr : labelEn, value]);
    r.getCell(1).font = { bold: true, color: { argb: NAVY } };
    r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_SOFT } };
    return r;
  }
  addField('اسم الفندق', 'Hotel Name', hotelName || '');
  addField('المدينة', 'City', cityName || '');
  addField('تاريخ الزيارة', 'Visit Date', row.visit_date || '');
  addField('رمز التقرير', 'Report Code', row.ref || '');
  addField('المفتش', 'Inspector', row.inspector_name || '');
  const overallRow = addField('النتيجة الإجمالية', 'Overall Score', sc.overall + '%');
  const overallArgb = scoreArgb(sc.overall);
  if (overallArgb) overallRow.getCell(2).font = { bold: true, size: 13, color: { argb: overallArgb } };
  addField('التقييم', 'Grade', isAr ? grade.ar : grade.en);
  addField('الامتثال للمعايير الإلزامية', 'Mandatory Compliance', mandatory === null ? '—' : mandatory + '%');
  addField('عدد الإخفاقات الحرجة', 'Critical Fails', String(sc.criticalFails.length));
  addField('عدد المعايير المجابة', 'Answered Items', `${sc.answeredCount} / ${sc.totalItems}`);

  // ---- Sheet 2: Category breakdown ----
  const catSheet = wb.addWorksheet(isAr ? 'أداء الأقسام' : 'Category Breakdown', {
    views: [{ rightToLeft: isAr }]
  });
  catSheet.columns = [
    { header: isAr ? 'القسم' : 'Category', key: 'cat', width: 38 },
    { header: isAr ? 'النتيجة' : 'Score', key: 'score', width: 14 },
    { header: isAr ? 'عدد الإجابات المعتمدة' : 'Sample Size', key: 'count', width: 18 }
  ];
  catSheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center' };
  });
  const scoredCats = cats.filter(c => sc.catScores[c.id] !== null && sc.catScores[c.id] !== undefined)
    .slice().sort((a, b) => sc.catScores[b.id] - sc.catScores[a.id]);
  scoredCats.forEach(c => {
    const score = sc.catScores[c.id];
    const r = catSheet.addRow([isAr ? c.ar : c.en, score + '%', sc.catCounts[c.id] || 0]);
    const argb = scoreArgb(score);
    if (argb) r.getCell(2).font = { bold: true, color: { argb } };
  });

  // ---- Sheet 3: Full checklist ----
  const chk = wb.addWorksheet(isAr ? 'قائمة المعايير الكاملة' : 'Full Checklist', {
    views: [{ rightToLeft: isAr }]
  });
  chk.columns = [
    { header: isAr ? 'القسم' : 'Category', key: 'cat', width: 26 },
    { header: isAr ? 'المعيار' : 'Item', key: 'item', width: 56 },
    { header: isAr ? 'التصنيف' : 'Class', key: 'cls', width: 20 },
    { header: isAr ? 'جوهري' : 'Critical', key: 'crit', width: 10 },
    { header: isAr ? 'الإجابة' : 'Answer', key: 'answer', width: 12 },
    { header: isAr ? 'ملاحظة' : 'Note', key: 'note', width: 46 }
  ];
  chk.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center' };
  });
  const answerLabel = { yes: isAr ? 'نعم' : 'Yes', no: isAr ? 'لا' : 'No', na: isAr ? 'غير منطبق' : 'N/A' };
  cats.forEach(cat => {
    cat.items.forEach(item => {
      const a = answers[item.id] || {};
      const clsMeta = CLASS_META[item.cls] || {};
      const r = chk.addRow([
        isAr ? cat.ar : cat.en,
        isAr ? item.ar : item.en,
        isAr ? clsMeta.ar : clsMeta.en,
        item.crit ? (isAr ? 'نعم' : 'Yes') : '',
        a.value ? answerLabel[a.value] : '',
        a.note || ''
      ]);
      if (a.value === 'no') {
        r.getCell(5).font = { bold: true, color: { argb: RED } };
        if (item.crit) r.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE9E7' } }; });
      } else if (a.value === 'yes') {
        r.getCell(5).font = { color: { argb: GREEN } };
      }
      r.alignment = { wrapText: true, vertical: 'top' };
    });
  });
  chk.views = [{ state: 'frozen', ySplit: 1, rightToLeft: isAr }];

  return wb.xlsx.writeBuffer();
}

module.exports = { buildInspectionExcelBuffer };
