import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const searchParams = request.nextUrl.searchParams;
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

    // Fetch lending records for students
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
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch lending items
    const orderIds = lendingOrders?.map((o: any) => o.lending_order_id) || [];
    
    const { data: lendingItems } = await supabase
      .from("lending_item")
      .select(`
        lend_order_id,
        quantity,
        product_id,
        products (
          product_name
        )
      `)
      .in("lend_order_id", orderIds.length > 0 ? orderIds : [""]);

    // Group lending items by order ID
    const itemsByOrderId = new Map<string, any[]>();
    lendingItems?.forEach((item: any) => {
      const orderId = item.lend_order_id;
      if (!itemsByOrderId.has(orderId)) {
        itemsByOrderId.set(orderId, []);
      }
      itemsByOrderId.get(orderId)!.push(item);
    });

    // Fetch student data
    const studentIds = lendingOrders
      ?.filter((o: any) => o.borrower_student_id)
      .map((o: any) => o.borrower_student_id) || [];

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select(`
        student_id,
        name,
        department_id,
        departments (
          department_name
        )
      `)
      .in("student_id", studentIds.length > 0 ? studentIds : [""]);

    if (studentsError) {
      console.error("Error fetching students:", studentsError);
    }

    // Fetch mentor data
    const mentorIds = lendingOrders
      ?.filter((o: any) => o.mentor_staff_id)
      .map((o: any) => o.mentor_staff_id) || [];

    const { data: mentors } = await supabase
      .from("staffs")
      .select("staff_id, name")
      .in("staff_id", mentorIds.length > 0 ? mentorIds : [""]);

    // Create lookup maps
    const studentMap = new Map(students?.map((s: any) => [s.student_id, s]) || []);
    const mentorMap = new Map(mentors?.map((m: any) => [m.staff_id, m.name]) || []);

    // Transform data
    const records = (lendingOrders || []).flatMap((order: any) => {
      const student = studentMap.get(order.borrower_student_id);
      
      // Handle departments - could be an object or null
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
          product_name: "—",
          quantity: 0,
          borrow_date: order.created_at,
          return_date: order.return_date,
          status: order.status || "PENDING",
          mobile: "—",
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
          borrow_date: order.created_at,
          return_date: order.return_date,
          status: order.status || "PENDING",
          mobile: "—",
        };
      });
    });

    // Calculate stats - unique students
    const uniqueStudents = new Set(records.map(r => r.student_id).filter(id => id));
    const totalBorrowed = uniqueStudents.size;
    
    // Count unique students who have returned
    const returnedStudents = new Set(
      records
        .filter(r => r.status === "RETURNED")
        .map(r => r.student_id)
        .filter(id => id)
    );
    const returned = returnedStudents.size;
    
    // Count unique students with pending items
    const pendingStudents = new Set(
      records
        .filter(r => r.status === "PENDING")
        .map(r => r.student_id)
        .filter(id => id)
    );
    const pending = pendingStudents.size;

    return NextResponse.json({
      records,
      stats: {
        totalBorrowed,
        returned,
        pending,
      },
    });
  } catch (error) {
    console.error("Error fetching student records:", error);
    return NextResponse.json(
      { error: "Failed to fetch student records" },
      { status: 500 }
    );
  }
}
