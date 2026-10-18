/** Downloads a small sample Excel file, made in the browser (the Excel library loads on demand). */
export async function downloadSample() {
  const { sampleWorkbook } = await import('@shared/importer.js');
  const blob = new Blob([sampleWorkbook()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'customers-sample.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
