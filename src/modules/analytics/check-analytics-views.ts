import { prisma } from "@/shared/utils/prismaClient.js";

async function main() {
    const views = [
        "analytics.v_sales_transaction_fact",
        "analytics.v_supplier_transaction_fact",
        "analytics.v_sales_order_delay_current",
        "analytics.v_production_order_delay_current",
        "analytics.v_sales_production_allocation_current",
        "analytics.v_customer_delay_exposure_current",
    ];

    for (const view of views) {
        try {
            const result = await prisma.$queryRawUnsafe<any[]>(`SELECT * FROM ${view} LIMIT 1`);
            console.log(`\n=== ${view} ===`);
            if (result.length > 0) {
                console.log("Sample row:", JSON.stringify(result[0], (k, v) => typeof v === 'bigint' ? v.toString() : v, 2));
            } else {
                console.log("(0 rows)");
            }
        } catch (error) {
            console.error(
                `${view}: query failed`,
                error instanceof Error ? error.message : error,
            );
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());