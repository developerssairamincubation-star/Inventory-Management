import { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { ApiError } from '@/lib/api/errors'
import { getPeriod, getStartDateByPeriod } from '@/lib/api/request'
import { fromError, ok } from '@/lib/api/response'
import { getAuthUser, unauthorizedResponse } from "@/lib/authMiddleware";

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
        mentor_staff_id
      `)
      .eq("borrower_type", "STUDENT")
      .eq("issued_by_user_id", user.user_id)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) throw new ApiError(500, 'DATABASE_ERROR', error.message)

    const orderIds = lendingOrders?.map((o: any) => o.lending_order_id) || [];

    const { data: lendingItems } = await supabase
      .from("lending_item")
      .select(`
        lend_order_id,
        quantity,
        original_quantity,
        damaged_quantity,
        lost_quantity,
        product_id,
        products (product_name)
      `)
      .in("lend_order_id", orderIds.length > 0 ? orderIds : [""]);

    const itemsByOrderId = new Map<string, any[]>();
    lendingItems?.forEach((item: any) => {
      const orderId = item.lend_order_id;
      if (!itemsByOrderId.has(orderId)) itemsByOrderId.set(orderId, []);
      itemsByOrderId.get(orderId)!.push(item);
    });

    const studentIds = lendingOrders
      ?.filter((o: any) => o.borrower_student_id)
      .map((o: any) => o.borrower_student_id) || [];

    const { data: students } = await supabase
      .from("students")
      .select(`student_id, name, department_id, departments (department_name)`)
      .in("student_id", studentIds.length > 0 ? studentIds : [""]);

    const mentorIds = lendingOrders
      ?.filter((o: any) => o.mentor_staff_id)
      .map((o: any) => o.mentor_staff_id) || [];

    const { data: mentors } = await supabase
      .from("staffs")
      .select("staff_id, name")
      .in("staff_id", mentorIds.length > 0 ? mentorIds : [""]);

    const studentMap = new Map(students?.map((s: any) => [s.student_id, s]) || []);
    const mentorMap = new Map(mentors?.map((m: any) => [m.staff_id, m.name]) || []);

    const records = (lendingOrders || []).flatMap((order: any) => {
      const student = studentMap.get(order.borrower_student_id);
      const department = Array.isArray(student?.departments)
        ? student?.departments[0]
        : student?.departments;
      const orderItems = itemsByOrderId.get(order.lending_order_id) || [];

      if (orderItems.length === 0) {
        return [{
          student_id: student?.student_id || "",
          student_name: student?.name || "—",
          department: department?.department_name || "—",
          mentor: mentorMap.get(order.mentor_staff_id) || "—",
          product_name: "—", quantity: 0,
          borrow_date: order.created_at, return_date: order.return_date,
          status: order.status || "PENDING", mobile: "—",
        }];
      }

      return orderItems.map((item: any) => {
        const product = item?.products;
        return {
          student_id: student?.student_id || "",
          student_name: student?.name || "—",
          department: department?.department_name || "—",
          mentor: mentorMap.get(order.mentor_staff_id) || "—",
          product_name: product?.product_name || "—",
          quantity: item?.quantity || 0,
          original_quantity: item?.original_quantity ?? item?.quantity ?? 0,
          damaged_quantity: item?.damaged_quantity ?? 0,
          lost_quantity: item?.lost_quantity ?? 0,
          borrow_date: order.created_at,
          return_date: order.return_date,
          status: order.status || "PENDING",
          mobile: "—",
        };
      });
    });

    const uniqueStudents = new Set(records.map(r => r.student_id).filter(id => id));
    const totalBorrowed = uniqueStudents.size;
    const returnedStudents = new Set(records.filter(r => r.status === "RETURNED").map(r => r.student_id).filter(id => id));
    const pendingStudents = new Set(records.filter(r => r.status === "PENDING").map(r => r.student_id).filter(id => id));

    return ok({
      records,
      stats: { totalBorrowed, returned: returnedStudents.size, pending: pendingStudents.size },
    });
  } catch (error) {
    return fromError(error)
  }
}
