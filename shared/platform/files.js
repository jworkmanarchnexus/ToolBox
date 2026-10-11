/* Files: hand the person a generated file (PDF, Excel, CSV, PNG, JSON). CONTRACT section 5.
   Locally and in production this is an ordinary browser download. */
export const Files = {
  /* data: a Blob, an ArrayBuffer/typed array, or a string */
  save({ filename, data, type }) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
};
