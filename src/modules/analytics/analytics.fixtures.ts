/**
 * Track A Certified Synthetic Fixture Data
 * Source: Master Blueprint v1.2, Appendix C & Section 6
 * Dataset ID: executive-copilot-demo / 1.0.0
 * Fixed as-of clock: 15 August 2026, 08:30 Europe/Rome (2026-08-15T06:30:00Z)
 * Reporting currency: EUR, net of VAT
 */

export const DEMO_DATASET_MANIFEST = {
  dataset_id: "executive-copilot-demo",
  version: "1.0.0",
  as_of: "2026-08-15T06:30:00Z",
  reporting_timezone: "Europe/Rome",
  reporting_currency: "EUR",
  synthetic_data: true,
  lifecycle_state: "APPROVED",
};

export interface SalesTransactionFact {
  transaction_id: string;
  posting_at: string;
  transaction_type: "INVOICE" | "CREDIT";
  customer_id: string;
  customer_code: string;
  customer_name: string;
  currency: string;
  net_amount: number;
  fixture_window: "Q3-CURRENT" | "Q2-46D" | "PY-46D";
}

export const SALES_TRANSACTION_FACTS: SalesTransactionFact[] = [
  // Current Q3 2026 window (1 July – 15 August 2026)
  {
    transaction_id: "TX-26-001",
    posting_at: "2026-07-03T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-001",
    customer_code: "OPTINORD",
    customer_name: "OptiNord",
    currency: "EUR",
    net_amount: 185000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-002",
    posting_at: "2026-07-08T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
    currency: "EUR",
    net_amount: 148000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-003",
    posting_at: "2026-07-15T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-003",
    customer_code: "MEDLENS",
    customer_name: "MedLens",
    currency: "EUR",
    net_amount: 112000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-004",
    posting_at: "2026-07-24T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-004",
    customer_code: "EUROPHOTONICS",
    customer_name: "EuroPhotonics",
    currency: "EUR",
    net_amount: 96000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-005",
    posting_at: "2026-08-02T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-005",
    customer_code: "LUMATECH",
    customer_name: "LumaTech",
    currency: "EUR",
    net_amount: 81000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-006",
    posting_at: "2026-08-05T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-006",
    customer_code: "NOVAOPTICS",
    customer_name: "NovaOptics",
    currency: "EUR",
    net_amount: 90000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-007",
    posting_at: "2026-08-09T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-007",
    customer_code: "PRISMAWORKS",
    customer_name: "PrismaWorks",
    currency: "EUR",
    net_amount: 70000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-008",
    posting_at: "2026-08-12T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-008",
    customer_code: "CLEARWAVE",
    customer_name: "ClearWave",
    currency: "EUR",
    net_amount: 48000,
    fixture_window: "Q3-CURRENT",
  },
  {
    transaction_id: "TX-26-009",
    posting_at: "2026-08-13T08:00:00Z",
    transaction_type: "CREDIT",
    customer_id: "CUS-008",
    customer_code: "CLEARWAVE",
    customer_name: "ClearWave",
    currency: "EUR",
    net_amount: -10000,
    fixture_window: "Q3-CURRENT",
  },

  // Equivalent Q2 2026 elapsed window (first 46 days: 1 April – 15 May 2026)
  {
    transaction_id: "TX-Q2-001",
    posting_at: "2026-04-03T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-001",
    customer_code: "OPTINORD",
    customer_name: "OptiNord",
    currency: "EUR",
    net_amount: 180000,
    fixture_window: "Q2-46D",
  },
  {
    transaction_id: "TX-Q2-002",
    posting_at: "2026-04-12T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
    currency: "EUR",
    net_amount: 160000,
    fixture_window: "Q2-46D",
  },
  {
    transaction_id: "TX-Q2-003",
    posting_at: "2026-04-25T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-003",
    customer_code: "MEDLENS",
    customer_name: "MedLens",
    currency: "EUR",
    net_amount: 150000,
    fixture_window: "Q2-46D",
  },
  {
    transaction_id: "TX-Q2-004",
    posting_at: "2026-05-08T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-004",
    customer_code: "EUROPHOTONICS",
    customer_name: "EuroPhotonics",
    currency: "EUR",
    net_amount: 140000,
    fixture_window: "Q2-46D",
  },
  {
    transaction_id: "TX-Q2-005",
    posting_at: "2026-05-15T06:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-005",
    customer_code: "LUMATECH",
    customer_name: "LumaTech",
    currency: "EUR",
    net_amount: 130000,
    fixture_window: "Q2-46D",
  },

  // Equivalent Q3 2025 prior-year window (first 46 days: 1 July – 15 August 2025)
  {
    transaction_id: "TX-PY-001",
    posting_at: "2025-07-03T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-001",
    customer_code: "OPTINORD",
    customer_name: "OptiNord",
    currency: "EUR",
    net_amount: 170000,
    fixture_window: "PY-46D",
  },
  {
    transaction_id: "TX-PY-002",
    posting_at: "2025-07-12T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
    currency: "EUR",
    net_amount: 150000,
    fixture_window: "PY-46D",
  },
  {
    transaction_id: "TX-PY-003",
    posting_at: "2025-07-25T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-003",
    customer_code: "MEDLENS",
    customer_name: "MedLens",
    currency: "EUR",
    net_amount: 140000,
    fixture_window: "PY-46D",
  },
  {
    transaction_id: "TX-PY-004",
    posting_at: "2025-08-08T08:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-004",
    customer_code: "EUROPHOTONICS",
    customer_name: "EuroPhotonics",
    currency: "EUR",
    net_amount: 130000,
    fixture_window: "PY-46D",
  },
  {
    transaction_id: "TX-PY-005",
    posting_at: "2025-08-15T06:00:00Z",
    transaction_type: "INVOICE",
    customer_id: "CUS-005",
    customer_code: "LUMATECH",
    customer_name: "LumaTech",
    currency: "EUR",
    net_amount: 110000,
    fixture_window: "PY-46D",
  },
];

export interface SupplierTransactionFact {
  transaction_id: string;
  posting_at: string;
  transaction_type: "INVOICE" | "CREDIT";
  supplier_id: string;
  supplier_code: string;
  supplier_name: string;
  currency: string;
  net_amount: number;
}

export const SUPPLIER_TRANSACTION_FACTS: SupplierTransactionFact[] = [
  {
    transaction_id: "STX-001",
    posting_at: "2026-07-04T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-001",
    supplier_code: "PRECGLASS",
    supplier_name: "Glass Italia",
    currency: "EUR",
    net_amount: 112000,
  },
  {
    transaction_id: "STX-002",
    posting_at: "2026-07-11T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-002",
    supplier_code: "CLEARCHEM",
    supplier_name: "ClearChem Europe",
    currency: "EUR",
    net_amount: 84000,
  },
  {
    transaction_id: "STX-003",
    posting_at: "2026-07-18T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-003",
    supplier_code: "MECHWORKS",
    supplier_name: "MechWorks Lombardia",
    currency: "EUR",
    net_amount: 71000,
  },
  {
    transaction_id: "STX-004",
    posting_at: "2026-08-01T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-004",
    supplier_code: "OPTICOAT",
    supplier_name: "OptiCoat Solutions",
    currency: "EUR",
    net_amount: 63000,
  },
  {
    transaction_id: "STX-005",
    posting_at: "2026-08-10T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-005",
    supplier_code: "PACKSECURE",
    supplier_name: "PackSecure",
    currency: "EUR",
    net_amount: 46000,
  },
  {
    transaction_id: "STX-006",
    posting_at: "2026-08-06T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-006",
    supplier_code: "SAFELOG",
    supplier_name: "SafeLogistics",
    currency: "EUR",
    net_amount: 55000,
  },
  {
    transaction_id: "STX-007",
    posting_at: "2026-08-07T08:00:00Z",
    transaction_type: "CREDIT",
    supplier_id: "SUP-006",
    supplier_code: "SAFELOG",
    supplier_name: "SafeLogistics",
    currency: "EUR",
    net_amount: -5000,
  },
  {
    transaction_id: "STX-008",
    posting_at: "2026-08-08T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-007",
    supplier_code: "MICROFAST",
    supplier_name: "MicroFasteners",
    currency: "EUR",
    net_amount: 44000,
  },
  {
    transaction_id: "STX-009",
    posting_at: "2026-08-12T08:00:00Z",
    transaction_type: "INVOICE",
    supplier_id: "SUP-008",
    supplier_code: "CLEANROOM",
    supplier_name: "CleanRoom Supply",
    currency: "EUR",
    net_amount: 40000,
  },
];

export interface SalesOrderDelayLine {
  sales_order_id: string;
  sales_order_line_id: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
  order_state: "OPEN" | "PARTIAL";
  open_qty: number;
  unit_net_price: number;
  currency: string;
  approved_commitment: string;
  remaining_net_value: number;
  is_delayed: boolean;
}

export const SALES_ORDER_DELAY_LINES: SalesOrderDelayLine[] = [
  {
    sales_order_id: "SO-260701",
    sales_order_line_id: "SOL-260701-1",
    customer_id: "CUS-001",
    customer_code: "OPTINORD",
    customer_name: "OptiNord",
    order_state: "OPEN",
    open_qty: 100,
    unit_net_price: 320.0,
    currency: "EUR",
    approved_commitment: "2026-08-10",
    remaining_net_value: 32000,
    is_delayed: true,
  },
  {
    sales_order_id: "SO-260701",
    sales_order_line_id: "SOL-260701-2",
    customer_id: "CUS-001",
    customer_code: "OPTINORD",
    customer_name: "OptiNord",
    order_state: "OPEN",
    open_qty: 50,
    unit_net_price: 295.2,
    currency: "EUR",
    approved_commitment: "2026-08-11",
    remaining_net_value: 14760,
    is_delayed: true,
  },
  {
    sales_order_id: "SO-260702",
    sales_order_line_id: "SOL-260702-1",
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
    order_state: "PARTIAL",
    open_qty: 80,
    unit_net_price: 350.0,
    currency: "EUR",
    approved_commitment: "2026-08-09",
    remaining_net_value: 28000,
    is_delayed: true,
  },
  {
    sales_order_id: "SO-260703",
    sales_order_line_id: "SOL-260703-1",
    customer_id: "CUS-003",
    customer_code: "MEDLENS",
    customer_name: "MedLens",
    order_state: "OPEN",
    open_qty: 100,
    unit_net_price: 250.0,
    currency: "EUR",
    approved_commitment: "2026-08-12",
    remaining_net_value: 25000,
    is_delayed: true,
  },
  {
    sales_order_id: "SO-260704",
    sales_order_line_id: "SOL-260704-1",
    customer_id: "CUS-004",
    customer_code: "EUROPHOTONICS",
    customer_name: "EuroPhotonics",
    order_state: "OPEN",
    open_qty: 110,
    unit_net_price: 200.0,
    currency: "EUR",
    approved_commitment: "2026-08-13",
    remaining_net_value: 22000,
    is_delayed: true,
  },
  {
    sales_order_id: "SO-260705",
    sales_order_line_id: "SOL-260705-1",
    customer_id: "CUS-005",
    customer_code: "LUMATECH",
    customer_name: "LumaTech",
    order_state: "PARTIAL",
    open_qty: 100,
    unit_net_price: 200.0,
    currency: "EUR",
    approved_commitment: "2026-08-14",
    remaining_net_value: 20000,
    is_delayed: true,
  },
  {
    sales_order_id: "SO-260706",
    sales_order_line_id: "SOL-260706-1",
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
    order_state: "OPEN",
    open_qty: 80,
    unit_net_price: 278.0,
    currency: "EUR",
    approved_commitment: "2026-08-07",
    remaining_net_value: 22240,
    is_delayed: true,
  },
];

export interface ProductionOrderDelayFact {
  production_order_id: string;
  order_state: "RELEASED" | "IN_PROGRESS";
  required_good_qty: number;
  accepted_good_qty: number;
  approved_cancelled_qty: number;
  remaining_required_good_qty: number;
  governing_finish: string;
  target_source: "APS_BASELINE" | "ORDER_TARGET";
  is_delayed: boolean;
}

export const PRODUCTION_ORDER_DELAY_FACTS: ProductionOrderDelayFact[] = [
  {
    production_order_id: "PO-88001",
    order_state: "RELEASED",
    required_good_qty: 100,
    accepted_good_qty: 0,
    approved_cancelled_qty: 0,
    remaining_required_good_qty: 100,
    governing_finish: "2026-08-09T15:00:00Z",
    target_source: "APS_BASELINE",
    is_delayed: true,
  },
  {
    production_order_id: "PO-88002",
    order_state: "IN_PROGRESS",
    required_good_qty: 80,
    accepted_good_qty: 20,
    approved_cancelled_qty: 0,
    remaining_required_good_qty: 60,
    governing_finish: "2026-08-08T15:00:00Z",
    target_source: "APS_BASELINE",
    is_delayed: true,
  },
  {
    production_order_id: "PO-88003",
    order_state: "RELEASED",
    required_good_qty: 100,
    accepted_good_qty: 0,
    approved_cancelled_qty: 0,
    remaining_required_good_qty: 100,
    governing_finish: "2026-08-11T15:00:00Z",
    target_source: "ORDER_TARGET",
    is_delayed: true,
  },
  {
    production_order_id: "PO-88004",
    order_state: "IN_PROGRESS",
    required_good_qty: 110,
    accepted_good_qty: 10,
    approved_cancelled_qty: 0,
    remaining_required_good_qty: 100,
    governing_finish: "2026-08-12T15:00:00Z",
    target_source: "APS_BASELINE",
    is_delayed: true,
  },
  {
    production_order_id: "PO-88005",
    order_state: "IN_PROGRESS",
    required_good_qty: 125,
    accepted_good_qty: 25,
    approved_cancelled_qty: 0,
    remaining_required_good_qty: 100,
    governing_finish: "2026-08-13T15:00:00Z",
    target_source: "ORDER_TARGET",
    is_delayed: true,
  },
  {
    production_order_id: "PO-88006",
    order_state: "RELEASED",
    required_good_qty: 80,
    accepted_good_qty: 0,
    approved_cancelled_qty: 0,
    remaining_required_good_qty: 80,
    governing_finish: "2026-08-06T15:00:00Z",
    target_source: "APS_BASELINE",
    is_delayed: true,
  },
];

export interface AllocationFact {
  allocation_id: string;
  sales_order_line_id: string;
  production_order_id: string;
  allocation_weight: number;
  open_value_eur: number;
  allocated_backlog_value: number;
  customer_id: string;
  customer_code: string;
  customer_name: string;
}

export const ALLOCATION_FACTS: AllocationFact[] = [
  {
    allocation_id: "AL-001",
    sales_order_line_id: "SOL-260701-1",
    production_order_id: "PO-88001",
    allocation_weight: 1.0,
    open_value_eur: 32000,
    allocated_backlog_value: 32000,
    customer_id: "CUS-001",
    customer_code: "OPTINORD",
    customer_name: "OptiNord",
  },
  {
    allocation_id: "AL-002",
    sales_order_line_id: "SOL-260702-1",
    production_order_id: "PO-88002",
    allocation_weight: 1.0,
    open_value_eur: 28000,
    allocated_backlog_value: 28000,
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
  },
  {
    allocation_id: "AL-003",
    sales_order_line_id: "SOL-260703-1",
    production_order_id: "PO-88003",
    allocation_weight: 1.0,
    open_value_eur: 25000,
    allocated_backlog_value: 25000,
    customer_id: "CUS-003",
    customer_code: "MEDLENS",
    customer_name: "MedLens",
  },
  {
    allocation_id: "AL-004",
    sales_order_line_id: "SOL-260704-1",
    production_order_id: "PO-88004",
    allocation_weight: 1.0,
    open_value_eur: 22000,
    allocated_backlog_value: 22000,
    customer_id: "CUS-004",
    customer_code: "EUROPHOTONICS",
    customer_name: "EuroPhotonics",
  },
  {
    allocation_id: "AL-005",
    sales_order_line_id: "SOL-260705-1",
    production_order_id: "PO-88005",
    allocation_weight: 1.0,
    open_value_eur: 20000,
    allocated_backlog_value: 20000,
    customer_id: "CUS-005",
    customer_code: "LUMATECH",
    customer_name: "LumaTech",
  },
  {
    allocation_id: "AL-006",
    sales_order_line_id: "SOL-260706-1",
    production_order_id: "PO-88006",
    allocation_weight: 1.0,
    open_value_eur: 22240,
    allocated_backlog_value: 22240,
    customer_id: "CUS-002",
    customer_code: "Rana",
    customer_name: "Rana",
  },
];

export const GOLDEN_VALIDATION_CHECKS = [
  {
    check_id: 1,
    name: "Current Q3 net invoiced sales",
    expected: 820000,
    actual: 820000,
    result: "PASS",
  },
  {
    check_id: 2,
    name: "Equivalent Q2 elapsed-period sales",
    expected: 760000,
    actual: 760000,
    result: "PASS",
  },
  {
    check_id: 3,
    name: "Variance vs equivalent Q2",
    expected: "+7.9%",
    actual: "+7.9%",
    result: "PASS",
  },
  {
    check_id: 4,
    name: "Equivalent Q3 prior-year sales",
    expected: 700000,
    actual: 700000,
    result: "PASS",
  },
  {
    check_id: 5,
    name: "Variance vs prior year",
    expected: "+17.1%",
    actual: "+17.1%",
    result: "PASS",
  },
  {
    check_id: 6,
    name: "Top-five customer sales",
    expected: 631000,
    actual: 631000,
    result: "PASS",
  },
  {
    check_id: 7,
    name: "Top-five customer share",
    expected: "77.0%",
    actual: "77.0%",
    result: "PASS",
  },
  {
    check_id: 8,
    name: "Approved procurement spend",
    expected: 510000,
    actual: 510000,
    result: "PASS",
  },
  {
    check_id: 9,
    name: "Top-five supplier spend",
    expected: 380000,
    actual: 380000,
    result: "PASS",
  },
  {
    check_id: 10,
    name: "Top-five supplier share",
    expected: "74.5%",
    actual: "74.5%",
    result: "PASS",
  },
  {
    check_id: 11,
    name: "Delayed sales orders",
    expected: 6,
    actual: 6,
    result: "PASS",
  },
  {
    check_id: 12,
    name: "Delayed sales-order lines",
    expected: 7,
    actual: 7,
    result: "PASS",
  },
  {
    check_id: 13,
    name: "Affected delayed-order customers",
    expected: 5,
    actual: 5,
    result: "PASS",
  },
  {
    check_id: 14,
    name: "Delayed sales backlog",
    expected: 164000,
    actual: 164000,
    result: "PASS",
  },
  {
    check_id: 15,
    name: "Delayed production orders",
    expected: 6,
    actual: 6,
    result: "PASS",
  },
  {
    check_id: 16,
    name: "Linked production orders",
    expected: 6,
    actual: 6,
    result: "PASS",
  },
  {
    check_id: 17,
    name: "Production-linked backlog",
    expected: 149240,
    actual: 149240,
    result: "PASS",
  },
  {
    check_id: 18,
    name: "Sales-production linkage coverage",
    expected: "91.0%",
    actual: "91.0%",
    result: "PASS",
  },
];

export const QUERY_CATALOG = [
  {
    journey_no: 1,
    query_id: "current-sales",
    display_name: "Current Q3 Net Invoiced Sales",
    operation_type: "METRIC_SUMMARY",
    lifecycle_state: "APPROVED",
  },
  {
    journey_no: 2,
    query_id: "sales-comparison",
    display_name: "Equivalent-Period Sales Comparison",
    operation_type: "PERIOD_COMPARE",
    lifecycle_state: "APPROVED",
  },
  {
    journey_no: 3,
    query_id: "top-customers",
    display_name: "Top 5 Customers by Sales",
    operation_type: "DIMENSION_RANK",
    lifecycle_state: "APPROVED",
  },
  {
    journey_no: 4,
    query_id: "supplier-spend",
    display_name: "Top 5 Suppliers by Procurement Spend",
    operation_type: "DIMENSION_RANK",
    lifecycle_state: "APPROVED",
  },
  {
    journey_no: 5,
    query_id: "delayed-orders",
    display_name: "Delayed Sales Commitments",
    operation_type: "DELAY_ANALYSIS",
    lifecycle_state: "APPROVED",
  },
  {
    journey_no: 6,
    query_id: "production-linkage",
    display_name: "Production Linkage & Exposure",
    operation_type: "LINKAGE_ANALYSIS",
    lifecycle_state: "APPROVED",
  },
];
