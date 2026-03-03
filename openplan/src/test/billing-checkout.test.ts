import { beforeEach, describe, expect, it, vi } from 'vitest'

const { createSessionMock, stripeConstructorMock } = vi.hoisted(() => {
  const createSessionMock = vi.fn()
  const stripeConstructorMock = vi.fn(function StripeMock() {
    return {
      checkout: {
        sessions: {
          create: createSessionMock,
        },
      },
    }
  })

  return { createSessionMock, stripeConstructorMock }
})

vi.mock('stripe', () => ({
  default: stripeConstructorMock,
}))

import { createStripeCheckoutSession } from '@/lib/billing/checkout'

describe('createStripeCheckoutSession', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    delete process.env.OPENPLAN_STRIPE_SECRET_KEY
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.OPENPLAN_STRIPE_PRICE_ID_STARTER
    delete process.env.OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL
  })

  it('throws when Stripe secret key is missing', async () => {
    process.env.OPENPLAN_STRIPE_PRICE_ID_STARTER = 'price_test_starter'

    await expect(
      createStripeCheckoutSession({
        workspaceId: 'workspace-1',
        plan: 'starter',
        initiatedByUserId: 'user-1',
        initiatedByUserEmail: 'owner@example.com',
        origin: 'https://openplan.example.com',
      })
    ).rejects.toThrow('Missing Stripe secret key configuration')
  })

  it('throws when price id for selected plan is missing', async () => {
    process.env.OPENPLAN_STRIPE_SECRET_KEY = 'sk_test_checkout'

    await expect(
      createStripeCheckoutSession({
        workspaceId: 'workspace-1',
        plan: 'professional',
        initiatedByUserId: 'user-1',
        initiatedByUserEmail: 'owner@example.com',
        origin: 'https://openplan.example.com',
      })
    ).rejects.toThrow('Missing Stripe price ID for professional plan')
  })

  it('creates a starter checkout session with customer_email when customer id is absent', async () => {
    process.env.OPENPLAN_STRIPE_SECRET_KEY = 'sk_test_checkout'
    process.env.OPENPLAN_STRIPE_PRICE_ID_STARTER = 'price_starter_test'

    createSessionMock.mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    })

    const session = await createStripeCheckoutSession({
      workspaceId: 'workspace-123',
      plan: 'starter',
      initiatedByUserId: 'user-123',
      initiatedByUserEmail: 'owner@example.com',
      origin: 'https://openplan.example.com',
    })

    expect(stripeConstructorMock).toHaveBeenCalledWith('sk_test_checkout')
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_starter_test', quantity: 1 }],
        client_reference_id: 'workspace-123',
        customer: undefined,
        customer_email: 'owner@example.com',
      })
    )
    expect(session).toEqual({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    })
  })

  it('creates a professional checkout session reusing existing customer id', async () => {
    process.env.OPENPLAN_STRIPE_SECRET_KEY = 'sk_test_checkout'
    process.env.OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL = 'price_professional_test'

    createSessionMock.mockResolvedValue({
      id: 'cs_test_456',
      url: 'https://checkout.stripe.com/c/pay/cs_test_456',
    })

    await createStripeCheckoutSession({
      workspaceId: 'workspace-456',
      plan: 'professional',
      initiatedByUserId: 'user-456',
      initiatedByUserEmail: 'owner@example.com',
      existingStripeCustomerId: 'cus_existing_123',
      origin: 'https://openplan.example.com',
    })

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_professional_test', quantity: 1 }],
        customer: 'cus_existing_123',
        customer_email: undefined,
      })
    )
  })
})
