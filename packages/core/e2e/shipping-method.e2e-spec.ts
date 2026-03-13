/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    defaultShippingCalculator,
    defaultShippingEligibilityChecker,
    ShippingCalculator,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { manualFulfillmentHandler } from '../src/config/fulfillment/manual-fulfillment-handler';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { SHIPPING_METHOD_FRAGMENT } from './graphql/fragments';
import * as Codegen from './graphql/generated-e2e-admin-types';
import { DeletionResult, LanguageCode } from './graphql/generated-e2e-admin-types';
import {
    ASSIGN_PRODUCTVARIANT_TO_CHANNEL,
    CREATE_CHANNEL,
    CREATE_SHIPPING_METHOD,
    DELETE_SHIPPING_METHOD,
    GET_ORDER,
    GET_SHIPPING_METHOD_LIST,
    UPDATE_SHIPPING_METHOD,
} from './graphql/shared-definitions';
import {
    ADD_ITEM_TO_ORDER,
    ADD_PAYMENT,
    GET_ACTIVE_ORDER,
    GET_ACTIVE_SHIPPING_METHODS,
    SET_CUSTOMER,
    SET_SHIPPING_ADDRESS,
    SET_SHIPPING_METHOD,
    TRANSITION_TO_STATE,
} from './graphql/shop-definitions';

const TEST_METADATA = {
    foo: 'bar',
    baz: [1, 2, 3],
};

const calculatorWithMetadata = new ShippingCalculator({
    code: 'calculator-with-metadata',
    description: [{ languageCode: LanguageCode.en, value: 'Has metadata' }],
    args: {},
    calculate: () => {
        return {
            price: 100,
            priceIncludesTax: true,
            taxRate: 0,
            metadata: TEST_METADATA,
        };
    },
});

describe('ShippingMethod resolver', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        paymentOptions: {
            paymentMethodHandlers: [testSuccessfulPaymentMethod],
        },
        shippingOptions: {
            shippingEligibilityCheckers: [defaultShippingEligibilityChecker],
            shippingCalculators: [defaultShippingCalculator, calculatorWithMetadata],
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('shippingEligibilityCheckers', async () => {
        const { shippingEligibilityCheckers } =
            await adminClient.query<Codegen.GetEligibilityCheckersQuery>(GET_ELIGIBILITY_CHECKERS);

        expect(shippingEligibilityCheckers).toEqual([
            {
                args: [
                    {
                        description: 'Order is eligible only if its total is greater or equal to this value',
                        label: 'Minimum order value',
                        name: 'orderMinimum',
                        type: 'int',
                        ui: {
                            component: 'currency-form-input',
                        },
                    },
                ],
                code: 'default-shipping-eligibility-checker',
                description: 'Default Shipping Eligibility Checker',
            },
        ]);
    });

    it('shippingCalculators', async () => {
        const { shippingCalculators } = await adminClient.query<Codegen.GetCalculatorsQuery>(GET_CALCULATORS);

        expect(shippingCalculators).toEqual([
            {
                args: [
                    {
                        ui: {
                            component: 'currency-form-input',
                        },
                        description: null,
                        label: 'Shipping price',
                        name: 'rate',
                        type: 'int',
                    },
                    {
                        label: 'Price includes tax',
                        name: 'includesTax',
                        type: 'string',
                        description: null,
                        ui: {
                            component: 'select-form-input',
                            options: [
                                {
                                    label: [{ languageCode: LanguageCode.en, value: 'Includes tax' }],
                                    value: 'include',
                                },
                                {
                                    label: [{ languageCode: LanguageCode.en, value: 'Excludes tax' }],
                                    value: 'exclude',
                                },
                                {
                                    label: [
                                        { languageCode: LanguageCode.en, value: 'Auto (based on Channel)' },
                                    ],
                                    value: 'auto',
                                },
                            ],
                        },
                    },
                    {
                        ui: {
                            component: 'number-form-input',
                            min: 0,
                            suffix: '%',
                        },
                        description: null,
                        label: 'Tax rate',
                        name: 'taxRate',
                        type: 'float',
                    },
                ],
                code: 'default-shipping-calculator',
                description: 'Default Flat-Rate Shipping Calculator',
            },
            {
                args: [],
                code: 'calculator-with-metadata',
                description: 'Has metadata',
            },
        ]);
    });

    it('shippingMethods', async () => {
        const { shippingMethods } =
            await adminClient.query<Codegen.GetShippingMethodListQuery>(GET_SHIPPING_METHOD_LIST);
        expect(shippingMethods.totalItems).toEqual(3);
        expect(shippingMethods.items[0].code).toBe('standard-shipping');
        expect(shippingMethods.items[1].code).toBe('express-shipping');
        expect(shippingMethods.items[2].code).toBe('express-shipping-taxed');
    });

    it('shippingMethod', async () => {
        const { shippingMethod } = await adminClient.query<
            Codegen.GetShippingMethodQuery,
            Codegen.GetShippingMethodQueryVariables
        >(GET_SHIPPING_METHOD, {
            id: 'T_1',
        });
        expect(shippingMethod!.code).toBe('standard-shipping');
    });

    it('createShippingMethod', async () => {
        const { createShippingMethod } = await adminClient.query<
            Codegen.CreateShippingMethodMutation,
            Codegen.CreateShippingMethodMutationVariables
        >(CREATE_SHIPPING_METHOD, {
            input: {
                code: 'new-method',
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [
                        {
                            name: 'orderMinimum',
                            value: '0',
                        },
                    ],
                },
                calculator: {
                    code: calculatorWithMetadata.code,
                    arguments: [],
                },
                translations: [{ languageCode: LanguageCode.en, name: 'new method', description: '' }],
            },
        });

        expect(createShippingMethod).toEqual({
            id: 'T_4',
            code: 'new-method',
            name: 'new method',
            description: '',
            calculator: {
                code: 'calculator-with-metadata',
                args: [],
            },
            checker: {
                code: 'default-shipping-eligibility-checker',
                args: [
                    {
                        name: 'orderMinimum',
                        value: '0',
                    },
                ],
            },
        });
    });

    it('testShippingMethod', async () => {
        const { testShippingMethod } = await adminClient.query<
            Codegen.TestShippingMethodQuery,
            Codegen.TestShippingMethodQueryVariables
        >(TEST_SHIPPING_METHOD, {
            input: {
                calculator: {
                    code: calculatorWithMetadata.code,
                    arguments: [],
                },
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [
                        {
                            name: 'orderMinimum',
                            value: '0',
                        },
                    ],
                },
                lines: [{ productVariantId: 'T_1', quantity: 1 }],
                shippingAddress: {
                    streetLine1: '',
                    countryCode: 'GB',
                },
            },
        });

        expect(testShippingMethod).toEqual({
            eligible: true,
            quote: {
                price: 100,
                priceWithTax: 100,
                metadata: TEST_METADATA,
            },
        });
    });

    it('testEligibleShippingMethods', async () => {
        const { testEligibleShippingMethods } = await adminClient.query<
            Codegen.TestEligibleMethodsQuery,
            Codegen.TestEligibleMethodsQueryVariables
        >(TEST_ELIGIBLE_SHIPPING_METHODS, {
            input: {
                lines: [{ productVariantId: 'T_1', quantity: 1 }],
                shippingAddress: {
                    streetLine1: '',
                    countryCode: 'GB',
                },
            },
        });

        expect(testEligibleShippingMethods).toEqual([
            {
                id: 'T_4',
                name: 'new method',
                description: '',
                price: 100,
                priceWithTax: 100,
                metadata: TEST_METADATA,
            },

            {
                id: 'T_1',
                name: 'Standard Shipping',
                description: '',
                price: 500,
                priceWithTax: 500,
                metadata: null,
            },
            {
                id: 'T_2',
                name: 'Express Shipping',
                description: '',
                price: 1000,
                priceWithTax: 1000,
                metadata: null,
            },
            {
                id: 'T_3',
                name: 'Express Shipping (Taxed)',
                description: '',
                price: 1000,
                priceWithTax: 1200,
                metadata: null,
            },
        ]);
    });

    it('updateShippingMethod', async () => {
        const { updateShippingMethod } = await adminClient.query<
            Codegen.UpdateShippingMethodMutation,
            Codegen.UpdateShippingMethodMutationVariables
        >(UPDATE_SHIPPING_METHOD, {
            input: {
                id: 'T_4',
                translations: [{ languageCode: LanguageCode.en, name: 'changed method', description: '' }],
            },
        });

        expect(updateShippingMethod.name).toBe('changed method');
    });

    it('deleteShippingMethod', async () => {
        const listResult1 =
            await adminClient.query<Codegen.GetShippingMethodListQuery>(GET_SHIPPING_METHOD_LIST);
        expect(listResult1.shippingMethods.items.map(i => i.id)).toEqual(['T_1', 'T_2', 'T_3', 'T_4']);

        const { deleteShippingMethod } = await adminClient.query<
            Codegen.DeleteShippingMethodMutation,
            Codegen.DeleteShippingMethodMutationVariables
        >(DELETE_SHIPPING_METHOD, {
            id: 'T_4',
        });

        expect(deleteShippingMethod).toEqual({
            result: DeletionResult.DELETED,
            message: null,
        });

        const listResult2 =
            await adminClient.query<Codegen.GetShippingMethodListQuery>(GET_SHIPPING_METHOD_LIST);
        expect(listResult2.shippingMethods.items.map(i => i.id)).toEqual(['T_1', 'T_2', 'T_3']);
    });

    describe('argument ordering', () => {
        it('createShippingMethod corrects order of arguments', async () => {
            const { createShippingMethod } = await adminClient.query<
                Codegen.CreateShippingMethodMutation,
                Codegen.CreateShippingMethodMutationVariables
            >(CREATE_SHIPPING_METHOD, {
                input: {
                    code: 'new-method',
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [
                            {
                                name: 'orderMinimum',
                                value: '0',
                            },
                        ],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '20' },
                            { name: 'includesTax', value: 'include' },
                        ],
                    },
                    translations: [{ languageCode: LanguageCode.en, name: 'new method', description: '' }],
                },
            });

            expect(createShippingMethod.calculator).toEqual({
                code: defaultShippingCalculator.code,
                args: [
                    { name: 'rate', value: '500' },
                    { name: 'includesTax', value: 'include' },
                    { name: 'taxRate', value: '20' },
                ],
            });
        });

        it('updateShippingMethod corrects order of arguments', async () => {
            const { updateShippingMethod } = await adminClient.query<
                Codegen.UpdateShippingMethodMutation,
                Codegen.UpdateShippingMethodMutationVariables
            >(UPDATE_SHIPPING_METHOD, {
                input: {
                    id: 'T_5',
                    translations: [],
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '20' },
                            { name: 'includesTax', value: 'include' },
                        ],
                    },
                },
            });

            expect(updateShippingMethod.calculator).toEqual({
                code: defaultShippingCalculator.code,
                args: [
                    { name: 'rate', value: '500' },
                    { name: 'includesTax', value: 'include' },
                    { name: 'taxRate', value: '20' },
                ],
            });
        });

        it('get shippingMethod preserves correct ordering', async () => {
            const { shippingMethod } = await adminClient.query<
                Codegen.GetShippingMethodQuery,
                Codegen.GetShippingMethodQueryVariables
            >(GET_SHIPPING_METHOD, {
                id: 'T_5',
            });

            expect(shippingMethod?.calculator.args).toEqual([
                { name: 'rate', value: '500' },
                { name: 'includesTax', value: 'include' },
                { name: 'taxRate', value: '20' },
            ]);
        });

        it('testShippingMethod corrects order of arguments', async () => {
            const { testShippingMethod } = await adminClient.query<
                Codegen.TestShippingMethodQuery,
                Codegen.TestShippingMethodQueryVariables
            >(TEST_SHIPPING_METHOD, {
                input: {
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'taxRate', value: '0' },
                            { name: 'includesTax', value: 'include' },
                        ],
                    },
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [
                            {
                                name: 'orderMinimum',
                                value: '0',
                            },
                        ],
                    },
                    lines: [{ productVariantId: 'T_1', quantity: 1 }],
                    shippingAddress: {
                        streetLine1: '',
                        countryCode: 'GB',
                    },
                },
            });

            expect(testShippingMethod).toEqual({
                eligible: true,
                quote: {
                    metadata: null,
                    price: 500,
                    priceWithTax: 500,
                },
            });
        });
    });

    it('returns only active shipping methods', async () => {
        // Arrange: Delete all existing shipping methods using deleteShippingMethod
        const { shippingMethods } =
            await adminClient.query<Codegen.GetShippingMethodListQuery>(GET_SHIPPING_METHOD_LIST);

        for (const method of shippingMethods.items) {
            await adminClient.query<
                Codegen.DeleteShippingMethodMutation,
                Codegen.DeleteShippingMethodMutationVariables
            >(DELETE_SHIPPING_METHOD, {
                id: method.id,
            });
        }

        // Create a new active shipping method
        const { createShippingMethod } = await adminClient.query<
            Codegen.CreateShippingMethodMutation,
            Codegen.CreateShippingMethodMutationVariables
        >(CREATE_SHIPPING_METHOD, {
            input: {
                code: 'active-method',
                fulfillmentHandler: manualFulfillmentHandler.code,
                checker: {
                    code: defaultShippingEligibilityChecker.code,
                    arguments: [{ name: 'orderMinimum', value: '0' }],
                },
                calculator: {
                    code: defaultShippingCalculator.code,
                    arguments: [],
                },
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: 'Active Method',
                        description: 'This is an active shipping method',
                    },
                ],
            },
        });

        // Act: Query active shipping methods
        const { activeShippingMethods } = await shopClient.query(GET_ACTIVE_SHIPPING_METHODS);

        // Assert: Ensure only the new active method is returned
        expect(activeShippingMethods).toHaveLength(1);
        expect(activeShippingMethods[0].code).toBe('active-method');
        expect(activeShippingMethods[0].name).toBe('Active Method');
        expect(activeShippingMethods[0].description).toBe('This is an active shipping method');
    });

    // https://github.com/vendure-ecommerce/vendure/issues/4492
    describe('shipping line removal on channel unassign', () => {
        let channelId: string;
        let shippingMethodId: string;

        beforeAll(async () => {
            // Create a new channel
            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
                input: {
                    code: 'shipping-test-channel',
                    token: 'shipping-test-channel-token',
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            channelId = createChannel.id;

            // Create a shipping method and assign it to the new channel
            const { createShippingMethod } = await adminClient.query<
                Codegen.CreateShippingMethodMutation,
                Codegen.CreateShippingMethodMutationVariables
            >(CREATE_SHIPPING_METHOD, {
                input: {
                    code: 'channel-test-method',
                    fulfillmentHandler: manualFulfillmentHandler.code,
                    checker: {
                        code: defaultShippingEligibilityChecker.code,
                        arguments: [{ name: 'orderMinimum', value: '0' }],
                    },
                    calculator: {
                        code: defaultShippingCalculator.code,
                        arguments: [
                            { name: 'rate', value: '500' },
                            { name: 'includesTax', value: 'auto' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Channel Test Method', description: '' },
                    ],
                },
            });
            shippingMethodId = createShippingMethod.id;

            await adminClient.query(ASSIGN_SHIPPING_METHODS_TO_CHANNEL, {
                input: {
                    channelId,
                    shippingMethodIds: [shippingMethodId],
                },
            });

            // Assign product variant to the new channel
            await adminClient.query(ASSIGN_PRODUCTVARIANT_TO_CHANNEL, {
                input: {
                    channelId,
                    productVariantIds: ['T_1'],
                },
            });
        });

        it('recalculates active orders when shipping method is unassigned from channel', async () => {
            // Create an active order in the new channel with the shipping method
            shopClient.setChannelToken('shipping-test-channel-token');
            await shopClient.asAnonymousUser();
            await shopClient.query(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(SET_SHIPPING_METHOD, { id: [shippingMethodId] });

            // Verify shipping line is present and totals include shipping
            const { activeOrder: orderBefore } = await shopClient.query(GET_ACTIVE_ORDER);
            expect(orderBefore.shippingLines).toHaveLength(1);
            expect(orderBefore.shippingLines[0].shippingMethod.id).toBe(shippingMethodId);
            expect(orderBefore.shipping).toBe(500);
            expect(orderBefore.total).toBe(Number(orderBefore.subTotal) + 500);

            // Remove the shipping method from the channel
            await adminClient.query(REMOVE_SHIPPING_METHODS_FROM_CHANNEL, {
                input: {
                    channelId,
                    shippingMethodIds: [shippingMethodId],
                },
            });

            // Verify the shipping line has been removed and totals recalculated
            const { activeOrder: orderAfter } = await shopClient.query(GET_ACTIVE_ORDER);
            expect(orderAfter.shippingLines).toHaveLength(0);
            expect(orderAfter.shipping).toBe(0);
            expect(orderAfter.shippingWithTax).toBe(0);
            expect(orderAfter.total).toBe(orderAfter.subTotal);
            expect(orderAfter.totalWithTax).toBe(orderAfter.subTotalWithTax);

            // Reset shop client to default channel
            shopClient.setChannelToken('e2e-default-channel');
        });

        it('historical orders still resolve shipping method after unassignment', async () => {
            // Re-assign the shipping method to the channel so we can create a completed order
            await adminClient.query(ASSIGN_SHIPPING_METHODS_TO_CHANNEL, {
                input: {
                    channelId,
                    shippingMethodIds: [shippingMethodId],
                },
            });

            // Create a payment method in the test channel
            adminClient.setChannelToken('shipping-test-channel-token');
            await adminClient.query(CREATE_PAYMENT_METHOD, {
                input: {
                    code: 'test-payment-method',
                    translations: [
                        { languageCode: LanguageCode.en, name: 'Test Payment Method', description: '' },
                    ],
                    enabled: true,
                    handler: {
                        code: testSuccessfulPaymentMethod.code,
                        arguments: [],
                    },
                },
            });
            adminClient.setChannelToken('e2e-default-channel');

            // Create and complete an order
            shopClient.setChannelToken('shipping-test-channel-token');
            await shopClient.asAnonymousUser();
            await shopClient.query(ADD_ITEM_TO_ORDER, {
                productVariantId: 'T_1',
                quantity: 1,
            });
            await shopClient.query(SET_SHIPPING_METHOD, { id: [shippingMethodId] });
            await shopClient.query(SET_CUSTOMER, {
                input: {
                    firstName: 'Test',
                    lastName: 'Customer',
                    emailAddress: 'shipping-test@test.com',
                },
            });
            await shopClient.query(SET_SHIPPING_ADDRESS, {
                input: {
                    streetLine1: '1 Test Street',
                    countryCode: 'GB',
                },
            });
            await shopClient.query(TRANSITION_TO_STATE, { state: 'ArrangingPayment' });
            const { addPaymentToOrder: completedOrder } = await shopClient.query(ADD_PAYMENT, {
                input: {
                    method: testSuccessfulPaymentMethod.code,
                    metadata: {},
                },
            });

            // Remove the shipping method from the channel again
            await adminClient.query(REMOVE_SHIPPING_METHODS_FROM_CHANNEL, {
                input: {
                    channelId,
                    shippingMethodIds: [shippingMethodId],
                },
            });

            // Verify the historical order still resolves the shipping method
            adminClient.setChannelToken('shipping-test-channel-token');
            const { order } = await adminClient.query(GET_ORDER, {
                id: completedOrder.id,
            });
            expect(order.shippingLines).toHaveLength(1);
            expect(order.shippingLines[0].shippingMethod.id).toBe(shippingMethodId);
            expect(order.shippingLines[0].shippingMethod.name).toBe('Channel Test Method');

            // Reset clients to default channel
            shopClient.setChannelToken('e2e-default-channel');
            adminClient.setChannelToken('e2e-default-channel');
        });
    });
});

const GET_SHIPPING_METHOD = gql`
    query GetShippingMethod($id: ID!) {
        shippingMethod(id: $id) {
            ...ShippingMethod
        }
    }
    ${SHIPPING_METHOD_FRAGMENT}
`;

const GET_ELIGIBILITY_CHECKERS = gql`
    query GetEligibilityCheckers {
        shippingEligibilityCheckers {
            code
            description
            args {
                name
                type
                description
                label
                ui
            }
        }
    }
`;

const GET_CALCULATORS = gql`
    query GetCalculators {
        shippingCalculators {
            code
            description
            args {
                name
                type
                description
                label
                ui
            }
        }
    }
`;

const TEST_SHIPPING_METHOD = gql`
    query TestShippingMethod($input: TestShippingMethodInput!) {
        testShippingMethod(input: $input) {
            eligible
            quote {
                price
                priceWithTax
                metadata
            }
        }
    }
`;

export const TEST_ELIGIBLE_SHIPPING_METHODS = gql`
    query TestEligibleMethods($input: TestEligibleShippingMethodsInput!) {
        testEligibleShippingMethods(input: $input) {
            id
            name
            description
            price
            priceWithTax
            metadata
        }
    }
`;

const ASSIGN_SHIPPING_METHODS_TO_CHANNEL = gql`
    mutation AssignShippingMethodsToChannel($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
            name
        }
    }
`;

const REMOVE_SHIPPING_METHODS_FROM_CHANNEL = gql`
    mutation RemoveShippingMethodsFromChannel($input: RemoveShippingMethodsFromChannelInput!) {
        removeShippingMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`;

const CREATE_PAYMENT_METHOD = gql`
    mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            id
            code
            name
        }
    }
`;
