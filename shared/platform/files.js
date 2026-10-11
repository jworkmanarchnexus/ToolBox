/* Files: hand the person a generated file (PDF, Excel, CSV, PNG, JSON). CONTRACT section 5.
   Locally and in production this is an ordinary browser download. */
const TYPES = {
  pdf: 'application/pdf', png: 'image/png', csv: 'text/csv;charset=utf-8', json: 'application/json', zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const typeOf = (filename) => TYPES[String(filename).split('.').pop().toLowerCase()] || 'application/octet-stream';

export const Files = {
  /* data: a Blob, an ArrayBuffer/typed array, or a string */
  save({ filename, data, type }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || typeOf(filename) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};
