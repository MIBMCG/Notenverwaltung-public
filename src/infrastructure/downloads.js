export function downloadBlobFile(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  let downloadAnchor = null;
  try {
    downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', filename);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
  } finally {
    if (downloadAnchor) downloadAnchor.remove();
    URL.revokeObjectURL(url);
  }
}
