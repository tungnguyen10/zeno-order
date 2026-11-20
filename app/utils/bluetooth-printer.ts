// Minimal Web Bluetooth typings (not in the default DOM lib) for a generic ESC/POS thermal printer.
interface GattCharacteristic {
  writeValueWithoutResponse?: (value: Uint8Array) => Promise<void>
  writeValue: (value: Uint8Array) => Promise<void>
}
interface GattService { getCharacteristic: (uuid: number | string) => Promise<GattCharacteristic> }
interface GattServer { connect: () => Promise<GattServer>, disconnect: () => void, getPrimaryService: (uuid: number | string) => Promise<GattService> }
interface BluetoothDevice { name?: string, gatt?: GattServer }
interface BluetoothApi { requestDevice: (options: unknown) => Promise<BluetoothDevice> }

// Common UUIDs exposed by inexpensive BLE thermal printers.
const PRINTER_SERVICE = 0x18f0
const PRINTER_CHARACTERISTIC = 0x2af1
const CHUNK_SIZE = 256

export interface PrinterConnection {
  name: string
  write: (data: Uint8Array) => Promise<void>
  disconnect: () => void
}

function getBluetooth(): BluetoothApi | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as unknown as { bluetooth?: BluetoothApi }).bluetooth ?? null
}

export function bluetoothPrintingSupported(): boolean {
  return getBluetooth() !== null
}

/** Opens the browser's device chooser and connects to a BLE ESC/POS printer. Chromium + HTTPS only. */
export async function connectPrinter(): Promise<PrinterConnection> {
  const bluetooth = getBluetooth()
  if (!bluetooth) throw new Error('Trình duyệt không hỗ trợ in qua Bluetooth')

  const device = await bluetooth.requestDevice({
    filters: [{ services: [PRINTER_SERVICE] }],
    optionalServices: [PRINTER_SERVICE],
  })
  const gatt = device.gatt
  if (!gatt) throw new Error('Không kết nối được máy in')

  const server = await gatt.connect()
  const service = await server.getPrimaryService(PRINTER_SERVICE)
  const characteristic = await service.getCharacteristic(PRINTER_CHARACTERISTIC)

  return {
    name: device.name ?? 'Máy in bếp',
    async write(data: Uint8Array) {
      for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
        // slice() copies into a fresh ArrayBuffer-backed view, which BLE writes expect.
        const chunk = data.slice(offset, offset + CHUNK_SIZE)
        if (characteristic.writeValueWithoutResponse) await characteristic.writeValueWithoutResponse(chunk)
        else await characteristic.writeValue(chunk)
      }
    },
    disconnect() {
      gatt.disconnect()
    },
  }
}
