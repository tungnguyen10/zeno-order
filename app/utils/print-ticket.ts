import type { KitchenTicket } from '#shared/kitchen-ticket'

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, char => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'))
}

/** A self-contained HTML document for the browser/OS print dialog, sized to the paper (58 or 80 mm). Pure, so it is unit-testable. */
export function ticketHtml(ticket: KitchenTicket, widthMm = 80): string {
  const items = ticket.items.map((item) => {
    const options = item.options.length ? `<div class="opt">${escapeHtml(item.options.join(', '))}</div>` : ''
    const note = item.note ? `<div class="opt">* ${escapeHtml(item.note)}</div>` : ''
    return `<li><span class="qty">${item.qty}×</span><span class="name">${escapeHtml(item.name)}</span>${options}${note}</li>`
  }).join('')

  const meta: string[] = []
  if (ticket.customerName) meta.push(`<div>Tên: ${escapeHtml(ticket.customerName)}</div>`)
  if (ticket.customerPhone) meta.push(`<div>SĐT: ${escapeHtml(ticket.customerPhone)}</div>`)
  if (ticket.address) meta.push(`<div>Địa chỉ: ${escapeHtml(ticket.address)}</div>`)
  if (ticket.note) meta.push(`<div>Ghi chú: ${escapeHtml(ticket.note)}</div>`)

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Bếp #${escapeHtml(ticket.code)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 3mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${widthMm - 8}mm; font-family: 'Courier New', monospace; color: #000; }
  .code { text-align: center; font-size: 22px; font-weight: 700; }
  .place { text-align: center; font-size: 16px; margin-bottom: 2px; }
  .time { text-align: center; font-size: 13px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  ul { list-style: none; }
  li { margin-bottom: 6px; font-size: 15px; }
  .qty { font-weight: 700; margin-right: 6px; }
  .opt { font-size: 13px; padding-left: 18px; }
  .meta { font-size: 13px; }
  .meta div { margin-top: 2px; }
</style></head><body>
<div class="code">#${escapeHtml(ticket.code)}</div>
<div class="place">${escapeHtml(ticket.placeLabel)}</div>
${ticket.timeLabel ? `<div class="time">${escapeHtml(ticket.timeLabel)}</div>` : ''}
<hr>
<ul>${items}</ul>
${meta.length ? `<hr><div class="meta">${meta.join('')}</div>` : ''}
</body></html>`
}

/** Prints the ticket through a hidden iframe so no popup permission is needed (works for manual and auto-print). */
export function printTicketViaBrowser(ticket: KitchenTicket, widthMm = 80): void {
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const win = iframe.contentWindow
  const doc = win?.document
  if (!win || !doc) {
    iframe.remove()
    return
  }
  doc.open()
  doc.write(ticketHtml(ticket, widthMm))
  doc.close()
  const run = () => {
    win.focus()
    win.print()
    setTimeout(() => iframe.remove(), 1000)
  }
  if (doc.readyState === 'complete') run()
  else win.addEventListener('load', run)
}
