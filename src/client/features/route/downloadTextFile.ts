/** Offers `text` as a file download (Blob + temporary `<a download>`); the object URL is revoked afterwards. */
export function downloadTextFile(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.hidden = true
  document.body.appendChild(a)
  try {
    a.click()
  } finally {
    a.remove()
    // Revoke on the next tick: some browsers start the download asynchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
