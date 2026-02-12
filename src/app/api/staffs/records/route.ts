import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "monthly";

    // Calculate date range based on period
    const now = new Date();
    let startDate = new Date();
    
    switch (period.toLowerCase()) {
      case "daily":
        startDate.setDate(now.getDate() - 1);
        break;
      case "weekly":
        startDate.setDate(now.getDate() - 7);
        break;
      case "monthly":
        startDate.setMonth(now.getMonth() - 1);
        break;
      case "yearly":
        startDate.setFullYear(now.getFullYear() - 1);
        break;
    }

    // Fetch lending orders filtered by borrower_type = 'STAFF'
    const { data: orders, error: ordersError } = await supabase
      .from("lending_order")
      .select("*")
      .eq("borrower_type", "STAFF")
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false });

    if (ordersError) {
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    if (!orders || orders.length === 0) {
      return NextResponse.json({
        records: [],
        stats: { totalBorrowed: 0, returned: 0, pending: 0 },
      });
    }

    const orderIds = orders.map((o) => o.lending_order_id);

    // Fetch lending items for these orders
    const { data: items, error: itemsError } = await supabase
      .from("lending_item")
      .select("*")
      .in("lend_order_id", orderIds);

    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Build a map: lend_order_id -> lending_item[]
    const itemsMap = new Map<string, any[]>();
    (items || []).forEach((item) => {
      const orderId = item.lend_order_id;
      if (!itemsMap.has(orderId)) {
        itemsMap.set(orderId, []);
      }
      itemsMap.get(orderId)!.push(item);
    });

    // Collect unique IDs
    const staffIds = new Set<string>();
    const mentorIds = new Set<string>();
    const productIds = new Set<string>();

    orders.forEach((order) => {
      if (order.borrower_staff_id) staffIds.add(order.borrower_staff_id);
      if (order.mentor_staff_id) mentorIds.add(order.mentor_staff_id);
      const orderItems = itemsMap.get(order.lending_order_id) || [];
      orderItems.forEach((item) => {
        if (item.product_id) productIds.add(item.product_id);
      });
    });

    // Fetch staffs with their departments
    const { data: staffsData, error: staffsError } = await supabase
      .from("staffs")
      .select("staff_id, name, department_id, departments(department_name)")
      .in("staff_id", Array.from(staffIds));

    if (staffsError) {
      return NextResponse.json({ error: staffsError.message }, { status: 500 });
    }

    // Fetch mentors
    const { data: mentorsData, error: mentorsError } = await supabase
      .from("staffs")
      .select("staff_id, name")
      .in("staff_id", Array.from(mentorIds));

    if (mentorsError) {
      return NextResponse.json({ error: mentorsError.message }, { status: 500 });
    }

    // Fetch products
    const { data: productsData, error: productsError } = await supabase
      .from("products")
      .select("product_id, product_name")
      .in("product_id", Array.from(productIds));

    if (productsError) {
      return NextResponse.json({ error: productsError.message }, { status: 500 });
    }

    // Build lookup maps
    const staffsMap = new Map(
      (staffsData || []).map((s: any) => {
        let deptName = "—";
        if (s.departments) {
          if (Array.isArray(s.departments)) {
            deptName = s.departments[0]?.department_name || "—";
          } else {
            deptName = s.departments.department_name || "—";
          }
        }
        return [s.staff_id, { name: s.name, department_name: deptName }];
      })
    );

    const mentorsMap = new Map(
      (mentorsData || []).map((m: any) => [m.staff_id, m.name])
    );

    const productsMap = new Map(
      (productsData || []).map((p: any) => [p.product_id, p.product_name])
    );

    // Build records
    const records: any[] = [];
    orders.forEach((order) => {
      const orderItems = itemsMap.get(order.lending_order_id) || [];
      const staffInfo = staffsMap.get(order.borrower_staff_id) || { name: "—", department_name: "—" };
      const mentorName = order.mentor_staff_id ? mentorsMap.get(order.mentor_staff_id) || "—" : "—";

      orderItems.forEach((item) => {
        const productName = productsMap.get(item.product_id) || "—";
        records.push({
          staff_id: order.borrower_staff_id,
          staff_name: staffInfo.name,
          department: staffInfo.department_name,
          mentor: mentorName,
          product_name: productName,
          quantity: item.quantity || 0,
          borrow_date: order.created_at,
          return_date: item.return_date || null,
          status: order.status,
          mobile: "—", // Mobile field doesn't exist in database
        });
      });
    });

    // Calculate stats - unique staff counts
    const borrowedStaffIds = new Set<string>();
    const returnedStaffIds = new Set<string>();
    const pendingStaffIds = new Set<string>();

    orders.forEach((order) => {
      if (order.borrower_staff_id) {
        borrowedStaffIds.add(order.borrower_staff_id);
        
        if (order.status === "RETURNED") {
          returnedStaffIds.add(order.borrower_staff_id);
        } else if (order.status === "PENDING") {
          pendingStaffIds.add(order.borrower_staff_id);
        }
      }
    });

    const stats = {
      totalBorrowed: borrowedStaffIds.size,
      returned: returnedStaffIds.size,
      pending: pendingStaffIds.size,
    };

    return NextResponse.json({ records, stats });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
