import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { ApiError } from '@/lib/api/errors'
import { getPeriod, getStartDateByPeriod } from '@/lib/api/request'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from '@/lib/authMiddleware'

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const period = getPeriod(request.nextUrl.searchParams)
    const startDate = getStartDateByPeriod(period)

    const { data: lendingOrders, error } = await supabase
      .from("lending_order")
      .select(`
        lending_order_id,
        created_at,
        due_date,
        return_date,
        status,
        borrower_type,
        borrower_student_id,
        borrower_staff_id,
        mentor_staff_id,
        project_name
      `)
      .eq("issued_by_user_id", user.user_id)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)

    const orderIds = lendingOrders?.map((o: any) => o.lending_order_id) || [];
    const inClause = orderIds.length > 0 ? orderIds : [""];

    let { data: lendingItems, error: itemsError } = await supabase
      .from("lending_item")
      .select(`
        lend_order_id,
        quantity,
        original_quantity,
        damaged_quantity,
        lost_quantity,
        product_id,
        products (
          product_name,
          product_code
        )
      `)
      .in("lend_order_id", inClause);

    if (itemsError) {
      const { data: fallbackItems } = await supabase
        .from("lending_item")
        .select(`lend_order_id, quantity, product_id, products (product_name, product_code)`)
        .in("lend_order_id", inClause);
      lendingItems = fallbackItems as any;
    }

    const itemsByOrderId = new Map<string, any[]>();
    lendingItems?.forEach((item: any) => {
      const orderId = item.lend_order_id;
      if (!itemsByOrderId.has(orderId)) itemsByOrderId.set(orderId, []);
      itemsByOrderId.get(orderId)!.push(item);
    });

    const studentIds = lendingOrders
      ?.filter((o: any) => o.borrower_type === "STUDENT" && o.borrower_student_id)
      .map((o: any) => o.borrower_student_id) || [];

    const staffIds = lendingOrders
      ?.filter((o: any) => o.borrower_type === "STAFF" && o.borrower_staff_id)
      .map((o: any) => o.borrower_staff_id) || [];

    const { data: students } = await supabase
      .from("students")
      .select(`student_id, name, department_id, departments (department_name)`)
      .in("student_id", studentIds.length > 0 ? studentIds : [""]);

    const { data: staffs } = await supabase
      .from("staffs")
      .select(`staff_id, name, department_id, departments (department_name)`)
      .in("staff_id", staffIds.length > 0 ? staffIds : [""]);

    const mentorIds = lendingOrders
      ?.filter((o: any) => o.mentor_staff_id)
      .map((o: any) => o.mentor_staff_id) || [];

    const { data: mentors } = await supabase
      .from("staffs")
      .select("staff_id, name")
      .in("staff_id", mentorIds.length > 0 ? mentorIds : [""]);

    const studentMap = new Map(students?.map((s: any) => [s.student_id, s]) || []);
    const staffMap = new Map(staffs?.map((s: any) => [s.staff_id, s]) || []);
    const mentorMap = new Map(mentors?.map((m: any) => [m.staff_id, m.name]) || []);

    const records = (lendingOrders || []).flatMap((order: any) => {
      const borrower = order.borrower_type === "STUDENT"
        ? studentMap.get(order.borrower_student_id)
        : staffMap.get(order.borrower_staff_id);
      const department = borrower?.departments;
      const orderItems = itemsByOrderId.get(order.lending_order_id) || [];

      if (orderItems.length === 0) {
        return [{
          id: order.lending_order_id,
          borrower_name: borrower?.name || "—",
          borrower_type: order.borrower_type || "—",
          department: department?.department_name || "—",
          product_name: "—", product_code: "—", product_id: null,
          quantity: 0, original_quantity: 0, damaged_quantity: 0, lost_quantity: 0,
          lending_date: order.created_at, due_date: order.due_date, return_date: order.return_date,
          status: order.status || "PENDING", mentor: mentorMap.get(order.mentor_staff_id) || "—",
        }];
      }

      return orderItems.map((item: any) => {
        const product = item?.products;
        return {
          id: order.lending_order_id,
          borrower_name: borrower?.name || "—",
          borrower_type: order.borrower_type || "—",
          department: department?.department_name || "—",
          product_name: product?.product_name || "—",
          product_code: product?.product_code || "—",
          product_id: item?.product_id || null,
          quantity: item?.quantity || 0,
          original_quantity: item?.original_quantity ?? item?.quantity ?? 0,
          damaged_quantity: item?.damaged_quantity || 0,
          lost_quantity: item?.lost_quantity || 0,
          lending_date: order.created_at,
          due_date: order.due_date,
          return_date: order.return_date,
          status: order.status || "PENDING",
          mentor: mentorMap.get(order.mentor_staff_id) || "—",
        };
      });
    });

    const EXCLUDED = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST", "DAMAGED", "LOST"];
    const activeLentRecords = records.filter(r => !EXCLUDED.includes(r.status));
    const totalQuantity = activeLentRecords.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const uniqueProducts = new Set(activeLentRecords.map(r => r.product_name).filter(name => name !== "—")).size;
    const returned = records.filter(r => r.status === "RETURNED" || r.status === "RETURNED_DAMAGED" || r.status === "RETURNED_LOST").length;
    const pending = records.filter(r => ["PENDING", "CONSUMABLE", "PARTIALLY_RETURNED", "PARTIALLY_DAMAGED", "PARTIALLY_LOST"].includes(r.status)).length;

    return ok({ records, stats: { totalLent: uniqueProducts, totalQuantity, returned, pending } });
  } catch (error) {
    return fromError(error)
  }
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request)
  if (!user) return unauthorizedResponse()

  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();

    const {
      borrower_type,
      borrower_name,
      department_id,
      lending_items,
      lending_date,
      due_date,
      project_name,
      mentor_staff_id,
      status,
      borrower_id, // if provided, skip the name-lookup creation
    } = body;

    let borrowerId: string | null = borrower_id ?? null;

    if (!borrowerId) {
      if (borrower_type === "STUDENT") {
        const { data: existingStudent } = await supabase
          .from("students")
          .select("student_id")
          .eq("name", borrower_name)
          .eq("department_id", department_id)
          .maybeSingle();

        if (existingStudent) {
          borrowerId = existingStudent.student_id;
        } else {
          const { data: newStudent, error: studentError } = await supabase
            .from("students")
            .insert({ name: borrower_name, department_id })
            .select("student_id")
            .single();
          if (studentError) return NextResponse.json({ error: studentError.message }, { status: 500 });
          borrowerId = newStudent.student_id;
        }
      } else if (borrower_type === "STAFF") {
        const { data: existingStaff } = await supabase
          .from("staffs")
          .select("staff_id")
          .eq("name", borrower_name)
          .eq("department_id", department_id)
          .maybeSingle();

        if (existingStaff) {
          borrowerId = existingStaff.staff_id;
        } else {
          const { data: newStaff, error: staffError } = await supabase
            .from("staffs")
            .insert({ name: borrower_name, department_id })
            .select("staff_id")
            .single();
          if (staffError) return NextResponse.json({ error: staffError.message }, { status: 500 });
          borrowerId = newStaff.staff_id;
        }
      }
    }

    const orderData: any = {
      borrower_type,
      issued_by_user_id: user.user_id,
      created_at: lending_date || new Date().toISOString(),
      due_date: due_date || null,
      status: status || "PENDING",
      project_name: project_name || null,
      mentor_staff_id: mentor_staff_id || null,
    };

    if (borrower_type === "STUDENT") orderData.borrower_student_id = borrowerId;
    else if (borrower_type === "STAFF") orderData.borrower_staff_id = borrowerId;

    const { data: order, error: orderError } = await supabase
      .from("lending_order")
      .insert(orderData)
      .select()
      .single();

    if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 });

    const itemsToInsert = lending_items.map((item: any) => ({
      lend_order_id: order.lending_order_id,
      product_id: item.product_id,
      quantity: item.quantity,
      original_quantity: item.quantity,
      damaged_quantity: 0,
      lost_quantity: 0,
      status: status === "CONSUMABLE" ? "NON_RETURNABLE_GIVEN" : "ISSUED",
    }));

    const { data: items, error: itemsError } = await supabase
      .from("lending_item")
      .insert(itemsToInsert)
      .select();

    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

    for (const item of lending_items) {
      const { data: currentStock } = await supabase
        .from("stocks")
        .select("quantity")
        .eq("product_id", item.product_id)
        .single();

      if (currentStock) {
        await supabase
          .from("stocks")
          .update({ quantity: Math.max(0, (currentStock.quantity || 0) - item.quantity) })
          .eq("product_id", item.product_id);
      }
    }

    return NextResponse.json({ order, items }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create lending record" }, { status: 500 });
  }
}
