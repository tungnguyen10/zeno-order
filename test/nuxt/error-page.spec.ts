import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'

import ErrorPage from '../../app/error.vue'

describe('application error page', () => {
  it('renders the public store not-found state in Vietnamese', async () => {
    const wrapper = await mountSuspended(ErrorPage, {
      props: {
        error: {
          statusCode: 404,
          statusMessage: 'Không tìm thấy cửa hàng.',
        },
      },
    })

    expect(wrapper.get('h1').text()).toBe('Không tìm thấy cửa hàng.')
    expect(wrapper.get('a').attributes('href')).toBe('/')
  })
})
