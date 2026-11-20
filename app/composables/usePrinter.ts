import { buildKitchenTicket, encodeTicketEscPos, type TicketOrder } from '#shared/kitchen-ticket'
import { bluetoothPrintingSupported, connectPrinter, type PrinterConnection } from '../utils/bluetooth-printer'
import { printTicketViaBrowser } from '../utils/print-ticket'

export type PrintMethod = 'browser' | 'bluetooth'
export type PaperWidth = '58' | '80'

const METHOD_KEY = 'zeno:printer-method'
const AUTO_KEY = 'zeno:printer-autoprint'
const WIDTH_KEY = 'zeno:printer-width'

/** Thermal column counts: 58mm ≈ 32 chars, 80mm ≈ 48 chars. */
const COLUMNS: Record<PaperWidth, number> = { 58: 32, 80: 48 }

/** Kitchen printing for the order board: browser/OS dialog or a paired Bluetooth ESC/POS printer. */
export function usePrinter() {
  const method = useState<PrintMethod>('zeno:printer:method', () => 'browser')
  const autoPrint = useState<boolean>('zeno:printer:auto', () => false)
  const paperWidth = useState<PaperWidth>('zeno:printer:width', () => '80')
  const connection = useState<PrinterConnection | null>('zeno:printer:conn', () => null)
  const connecting = ref(false)
  const error = ref('')

  onMounted(() => {
    try {
      if (localStorage.getItem(METHOD_KEY) === 'bluetooth') method.value = 'bluetooth'
      autoPrint.value = localStorage.getItem(AUTO_KEY) === 'on'
      if (localStorage.getItem(WIDTH_KEY) === '58') paperWidth.value = '58'
    }
    catch {
      // Storage unavailable: fall back to the in-memory defaults.
    }
  })

  function setMethod(value: PrintMethod) {
    method.value = value
    try {
      localStorage.setItem(METHOD_KEY, value)
    }
    catch { /* ignore */ }
  }

  function setAutoPrint(value: boolean) {
    autoPrint.value = value
    try {
      localStorage.setItem(AUTO_KEY, value ? 'on' : 'off')
    }
    catch { /* ignore */ }
  }

  function setPaperWidth(value: PaperWidth) {
    paperWidth.value = value
    try {
      localStorage.setItem(WIDTH_KEY, value)
    }
    catch { /* ignore */ }
  }

  async function connect() {
    if (connecting.value) return
    connecting.value = true
    error.value = ''
    try {
      connection.value = await connectPrinter()
      setMethod('bluetooth')
    }
    catch (err) {
      // A user cancelling the chooser is not an error worth surfacing.
      error.value = (err as Error)?.name === 'NotFoundError' ? '' : ((err as Error)?.message ?? 'Không kết nối được máy in')
    }
    finally {
      connecting.value = false
    }
  }

  function disconnect() {
    connection.value?.disconnect()
    connection.value = null
  }

  /** Prints one order. Returns false when it could not be printed (e.g. no Bluetooth printer connected). */
  async function print(order: TicketOrder): Promise<boolean> {
    const ticket = buildKitchenTicket(order)
    const columns = COLUMNS[paperWidth.value]
    if (method.value === 'bluetooth') {
      if (!connection.value) return false
      try {
        await connection.value.write(encodeTicketEscPos(ticket, columns))
        return true
      }
      catch {
        // A dropped connection should not throw into the caller's render/update path.
        connection.value = null
        return false
      }
    }
    printTicketViaBrowser(ticket, Number(paperWidth.value))
    return true
  }

  return {
    method,
    autoPrint,
    paperWidth,
    connection,
    connecting,
    error,
    bluetoothSupported: bluetoothPrintingSupported(),
    setMethod,
    setAutoPrint,
    setPaperWidth,
    connect,
    disconnect,
    print,
  }
}
