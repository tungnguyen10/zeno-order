import type { SupabaseClient } from '@supabase/supabase-js'
import type { MerchantOrderDetail, MerchantOrderSummary, MerchantStoreSummary, OrderStatus } from '../../shared/types/merchant'

function mapStore(row: Record<string, unknown>): MerchantStoreSummary {
  return {
    id: String(row.id),
    publicSlug: String(row.public_slug),
    name: String(row.name),
    timezone: String(row.timezone),
    currency: String(row.currency),
  }
}

function mapOrder(row: Record<string, unknown>): MerchantOrderSummary {
  return {
    id: String(row.id),
    orderNumber: String(row.order_number),
    status: row.status as OrderStatus,
    fulfillmentType: row.fulfillment_type as 'delivery' | 'pickup',
    customerName: String(row.customer_name),
    total: String(row.total),
    paymentStatus: String(row.payment_status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export function createMerchantOrderRepository(client: SupabaseClient) {
  return {
    async listStores() {
      const { data, error } = await client.from('stores')
        .select('id,public_slug,name,timezone,currency')
        .order('name')
      if (error) throw new Error(error.message)
      return (data ?? []).map(row => mapStore(row))
    },

    async listOrders(storeId: string, status: OrderStatus | undefined, limit: number) {
      let query = client.from('orders')
        .select('id,order_number,status,fulfillment_type,customer_name,total,payment_status,created_at,updated_at')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (status) query = query.eq('status', status)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []).map(row => mapOrder(row))
    },

    async findOrder(storeId: string, orderNumber: string): Promise<MerchantOrderDetail | null> {
      const { data: order, error } = await client.from('orders')
        .select('id,order_number,status,fulfillment_type,customer_name,customer_phone,delivery_address,delivery_note,customer_note,subtotal,delivery_fee,discount_amount,total,payment_method,payment_status,created_at,updated_at')
        .eq('store_id', storeId)
        .eq('order_number', orderNumber)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!order) return null

      const [{ data: items, error: itemError }, { data: history, error: historyError }] = await Promise.all([
        client.from('order_items')
          .select('id,product_name,unit_price,quantity,line_total,note,order_item_options(option_group_name,option_name,price_adjustment)')
          .eq('store_id', storeId)
          .eq('order_id', order.id)
          .order('created_at'),
        client.from('order_status_history')
          .select('from_status,to_status,note,created_at')
          .eq('store_id', storeId)
          .eq('order_id', order.id)
          .order('created_at'),
      ])
      if (itemError) throw new Error(itemError.message)
      if (historyError) throw new Error(historyError.message)

      return {
        ...mapOrder(order),
        customerPhone: order.customer_phone,
        deliveryAddress: order.delivery_address,
        deliveryNote: order.delivery_note,
        customerNote: order.customer_note,
        subtotal: String(order.subtotal),
        deliveryFee: String(order.delivery_fee),
        discountAmount: String(order.discount_amount),
        paymentMethod: order.payment_method,
        items: (items ?? []).map(item => ({
          id: item.id,
          name: item.product_name,
          unitPrice: String(item.unit_price),
          quantity: item.quantity,
          lineTotal: String(item.line_total),
          note: item.note,
          options: (item.order_item_options ?? []).map(option => ({
            name: option.option_name,
            groupName: option.option_group_name,
            priceAdjustment: String(option.price_adjustment),
          })),
        })),
        history: (history ?? []).map(entry => ({
          fromStatus: entry.from_status as OrderStatus | null,
          toStatus: entry.to_status as OrderStatus,
          note: entry.note,
          createdAt: entry.created_at,
        })),
      }
    },

    async transition(storeId: string, orderNumber: string, status: OrderStatus, note: string | null) {
      const { data, error } = await client.rpc('transition_order_status', {
        p_store_id: storeId,
        p_order_number: orderNumber,
        p_to_status: status,
        p_note: note,
      }).single()
      if (error) throw new Error(error.message)
      return data
    },
  }
}
