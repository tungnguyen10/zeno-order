<script setup lang="ts">
useHead({ titleTemplate: '%s' })
useSeoMeta({
  title: 'ZENO Order — Đặt món tại bàn cho quán cafe & trà sữa',
  description: 'Khách quét QR, chọn món và thanh toán VietQR. Chủ quán nhận và xử lý đơn ngay trên điện thoại.',
  ogTitle: 'ZENO Order — Đặt món tại bàn, không cần app',
  ogDescription: 'Khách quét QR, chọn món và thanh toán VietQR. Chủ quán nhận và xử lý đơn ngay trên điện thoại.',
  ogType: 'website',
  ogLocale: 'vi_VN',
})

const benefits = [
  { icon: 'i-lucide-qr-code', title: 'QR tại bàn', description: 'Khách quét mã, xem menu và gọi món ngay trên điện thoại — không cần cài app.' },
  { icon: 'i-lucide-badge-check', title: 'VietQR tự đối soát', description: 'Tiền vào tài khoản là đơn tự chuyển “Đã thanh toán”, không phải dò sao kê.' },
  { icon: 'i-lucide-smartphone', title: 'Quản lý trên điện thoại', description: 'Nhận đơn, đổi trạng thái và bật/tắt nhận đơn ở bất kỳ đâu.' },
]

const steps = [
  { title: 'Tạo quán', description: 'Đăng ký và đặt tên cửa hàng trong một phút.' },
  { title: 'In mã QR', description: 'Dán QR lên bàn hoặc quầy thu ngân.' },
  { title: 'Nhận đơn', description: 'Đơn mới hiện ngay trên điện thoại của bạn.' },
]

const year = new Date().getFullYear()
</script>

<template>
  <div class="min-h-dvh bg-default">
    <a
      href="#main"
      class="sr-only z-50 rounded-md bg-primary px-4 py-3 font-medium text-(--zeno-on-primary) focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
    >Bỏ qua tới nội dung</a>

    <header class="sticky top-0 z-20 border-b border-default/60 bg-default/90 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <AppLogo to="/" />
        <div class="flex items-center gap-1 sm:gap-2">
          <AppColorModeToggle />
          <ZButton variant="ghost" to="/login" class="hidden sm:inline-flex">
            Đăng nhập
          </ZButton>
          <ZButton to="/signup" class="whitespace-nowrap">
            <span class="sm:hidden">Dùng thử</span>
            <span class="hidden sm:inline">Dùng thử miễn phí</span>
          </ZButton>
        </div>
      </div>
    </header>

    <main id="main">
      <section class="relative overflow-hidden">
        <div aria-hidden="true" class="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full bg-secondary/20 blur-3xl dark:bg-secondary/10" />
        <div class="mx-auto grid max-w-6xl gap-12 px-4 pb-16 pt-10 sm:px-6 lg:grid-cols-2 lg:items-center lg:gap-16 lg:pb-24 lg:pt-20">
          <div class="relative flex flex-col gap-6">
            <ZBadge icon="i-lucide-coffee" class="self-start">
              Dành cho quán cafe & trà sữa
            </ZBadge>
            <h1 class="font-display text-[2.5rem] leading-[1.1] font-semibold tracking-tight text-default sm:text-5xl lg:text-6xl">
              Đặt món tại bàn, <span class="text-primary">không cần app</span>
            </h1>
            <p class="max-w-prose text-lg text-muted">
              Khách quét QR, chọn món và thanh toán VietQR. Bạn nhận và xử lý đơn ngay trên điện thoại.
            </p>
            <div class="flex flex-col gap-3 sm:flex-row">
              <ZButton to="/signup" size="lg" trailing-icon="i-lucide-arrow-right">
                Tạo quán miễn phí
              </ZButton>
              <ZButton to="/login" size="lg" variant="secondary">
                Đăng nhập chủ quán
              </ZButton>
            </div>
            <ul class="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              <li class="flex items-center gap-1.5">
                <UIcon name="i-lucide-check" class="size-4 text-primary" /> Thiết lập trong 5 phút
              </li>
              <li class="flex items-center gap-1.5">
                <UIcon name="i-lucide-check" class="size-4 text-primary" /> Khách không cần cài app
              </li>
            </ul>
          </div>
          <LandingPhoneMockup />
        </div>
      </section>

      <section class="py-16 lg:py-24" aria-labelledby="benefits-title">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 id="benefits-title" class="max-w-xl text-h2 text-default">
            Mọi thứ quán nhỏ cần để nhận đơn online
          </h2>
          <ul class="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <li v-for="benefit in benefits" :key="benefit.title">
              <ZCard class="h-full">
                <div class="flex size-12 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <UIcon :name="benefit.icon" class="size-6" />
                </div>
                <h3 class="mt-5 text-h3 text-default">
                  {{ benefit.title }}
                </h3>
                <p class="mt-2 text-muted">
                  {{ benefit.description }}
                </p>
              </ZCard>
            </li>
          </ul>
        </div>
      </section>

      <section class="pb-16 lg:pb-24" aria-labelledby="steps-title">
        <div class="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 id="steps-title" class="text-h2 text-default">
            Bắt đầu trong 3 bước
          </h2>
          <ol class="mt-10 grid gap-8 sm:grid-cols-3">
            <li v-for="(step, index) in steps" :key="step.title" class="flex gap-4 sm:flex-col">
              <span class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary font-display text-xl font-semibold text-(--zeno-on-primary) shadow-raised-sm dark:shadow-none">
                {{ index + 1 }}
              </span>
              <div>
                <h3 class="text-h3 text-default">
                  {{ step.title }}
                </h3>
                <p class="mt-1 text-muted">
                  {{ step.description }}
                </p>
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section class="px-4 pb-16 sm:px-6 lg:pb-24" aria-labelledby="cta-title">
        <div class="relative mx-auto max-w-6xl overflow-hidden rounded-lg bg-primary px-6 py-12 text-center text-(--zeno-on-primary) sm:px-12">
          <div aria-hidden="true" class="pointer-events-none absolute -left-20 -top-20 size-64 rounded-full bg-white/10 blur-3xl" />
          <h2 id="cta-title" class="relative text-h2">
            Sẵn sàng nhận đơn đầu tiên?
          </h2>
          <p class="relative mx-auto mt-3 max-w-md opacity-95">
            Tạo quán miễn phí, in QR và bắt đầu bán ngay hôm nay.
          </p>
          <ZButton to="/signup" size="lg" variant="secondary" trailing-icon="i-lucide-arrow-right" class="relative mt-8">
            Tạo quán miễn phí
          </ZButton>
        </div>
      </section>
    </main>

    <footer class="border-t border-default pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6">
      <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-muted sm:flex-row sm:px-6">
        <AppLogo size="sm" />
        <p>© {{ year }} ZENO · Đặt món nhanh cho quán cafe & trà sữa</p>
        <nav aria-label="Tài khoản" class="flex gap-4">
          <NuxtLink to="/login" class="inline-flex min-h-11 items-center hover:text-default">
            Đăng nhập
          </NuxtLink>
          <NuxtLink to="/signup" class="inline-flex min-h-11 items-center hover:text-default">
            Đăng ký
          </NuxtLink>
        </nav>
      </div>
    </footer>
  </div>
</template>
