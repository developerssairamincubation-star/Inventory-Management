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

    // Fetch lending records with joins
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
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Database error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch lending items separately
    const orderIds = lendingOrders?.map((o: any) => o.lending_order_id) || [];
    
    const { data: lendingItems } = await supabase
      .from("lending_item")
      .select(`
        lend_order_id,
        quantity,
        product_id,
        products (
          product_name,
          product_code
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

    // Fetch student and staff data separately
    const studentIds = lendingOrders
      ?.filter((o: any) => o.borrower_type === "STUDENT" && o.borrower_student_id)
      .map((o: any) => o.borrower_student_id) || [];
    
    const staffIds = lendingOrders
      ?.filter((o: any) => o.borrower_type === "STAFF" && o.borrower_staff_id)
      .map((o: any) => o.borrower_staff_id) || [];

    const { data: students } = await supabase
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

    const { data: staffs } = await supabase
      .from("staffs")
      .select(`
        staff_id,
        name,
        department_id,
        departments (
          department_name
        )
      `)
      .in("staff_id", staffIds.length > 0 ? staffIds : [""]);

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
    const staffMap = new Map(staffs?.map((s: any) => [s.staff_id, s]) || []);
    const mentorMap = new Map(mentors?.map((m: any) => [m.staff_id, m.name]) || []);

    // Transform data to match the frontend structure
    const records = (lendingOrders || []).flatMap((order: any) => {
      const borrower = order.borrower_type === "STUDENT" 
        ? studentMap.get(order.borrower_student_id)
        : staffMap.get(order.borrower_staff_id);
      
      const department = borrower?.departments;
      const orderItems = itemsByOrderId.get(order.lending_order_id) || [];

      // If there are no items, still show the order with a placeholder
      if (orderItems.length === 0) {
        return [{
          id: order.lending_order_id,
          borrower_name: borrower?.name || "—",
          department: department?.department_name || "—",
          product_name: "—",
          product_code: "—",
          quantity: 0,
          lending_date: order.created_at,
          due_date: order.due_date,
          return_date: order.return_date,
          status: order.status || "PENDING",
          mentor: mentorMap.get(order.mentor_staff_id) || "—",
        }];
      }

      // Create a record for each lending item
      return orderItems.map((item: any) => {
        const product = item?.products;
        
        return {
          id: order.lending_order_id,
          borrower_name: borrower?.name || "—",
          department: department?.department_name || "—",
          product_name: product?.product_name || "—",
          product_code: product?.product_code || "—",
          quantity: item?.quantity || 0,
          lending_date: order.created_at,
          due_date: order.due_date,
          return_date: order.return_date,
          status: order.status || "PENDING",
          mentor: mentorMap.get(order.mentor_staff_id) || "—",
        };
      });
    });

    // Calculate stats - only count currently lent items (not returned)
    const activeLentRecords = records.filter(r => r.status !== "RETURNED");
    const totalQuantity = activeLentRecords.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const uniqueProducts = new Set(activeLentRecords.map(r => r.product_name).filter(name => name !== "—")).size;
    const returned = records.filter(r => r.status === "RETURNED").length;
    const pending = records.filter(r => r.status === "PENDING").length;

    return NextResponse.json({
      records,
      stats: {
        totalLent: uniqueProducts,
        totalQuantity,
        returned,
        pending,
      },
    });
  } catch (error) {
    console.error("Error fetching lending records:", error);
    return NextResponse.json(
      { error: "Failed to fetch lending records" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const body = await request.json();

    const {
      borrower_type,
      borrower_name,
      department_id,
      lending_items, // Array of { product_id, quantity }
      lending_date,
      due_date,
      project_name,
      mentor_staff_id,
      status,
    } = body;

    // First, create or find the borrower (student or staff)
    let borrowerId: string | null = null;

    if (borrower_type === "STUDENT") {
      // Check if student exists
      const { data: existingStudent } = await supabase
        .from("students")
        .select("student_id")
        .eq("name", borrower_name)
        .eq("department_id", department_id)
        .single();

      if (existingStudent) {
        borrowerId = existingStudent.student_id;
      } else {
        // Create new student
        const { data: newStudent, error: studentError } = await supabase
          .from("students")
          .insert({
            name: borrower_name,
            department_id,
          })
          .select("student_id")
          .single();

        if (studentError) {
          console.error("Error creating student:", studentError);
          return NextResponse.json({ error: studentError.message }, { status: 500 });
        }
        borrowerId = newStudent.student_id;
      }
    } else if (borrower_type === "STAFF") {
      // Check if staff exists
      const { data: existingStaff } = await supabase
        .from("staffs")
        .select("staff_id")
        .eq("name", borrower_name)
        .eq("department_id", department_id)
        .single();

      if (existingStaff) {
        borrowerId = existingStaff.staff_id;
      } else {
        // Create new staff
        const { data: newStaff, error: staffError } = await supabase
          .from("staffs")
          .insert({
            name: borrower_name,
            department_id,
          })
          .select("staff_id")
          .single();

        if (staffError) {
          console.error("Error creating staff:", staffError);
          return NextResponse.json({ error: staffError.message }, { status: 500 });
        }
        borrowerId = newStaff.staff_id;
      }
    }

    // Create lending order
    const orderData: any = {
      borrower_type,
      created_at: lending_date || new Date().toISOString(),
      due_date: due_date || null,
      status: status || "PENDING",
      project_name: project_name || null,
      mentor_staff_id: mentor_staff_id || null,
    };

    if (borrower_type === "STUDENT") {
      orderData.borrower_student_id = borrowerId;
    } else if (borrower_type === "STAFF") {
      orderData.borrower_staff_id = borrowerId;
    }

    const { data: order, error: orderError } = await supabase
      .from("lending_order")
      .insert(orderData)
      .select()
      .single();

    if (orderError) {
      console.error("Error creating lending order:", orderError);
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    // Create lending items (multiple items for same order)
    const itemsToInsert = lending_items.map((item: any) => ({
      lend_order_id: order.lending_order_id,
      product_id: item.product_id,
      quantity: item.quantity,
      status: status === "CONSUMABLE" ? "NON_RETURNABLE_GIVEN" : "ISSUED",
    }));

    const { data: items, error: itemsError } = await supabase
      .from("lending_item")
      .insert(itemsToInsert)
      .select();

    if (itemsError) {
      console.error("Error creating lending items:", itemsError);
      console.error("Full error details:", JSON.stringify(itemsError, null, 2));
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Reduce stock quantities
    for (const item of lending_items) {
      const { data: currentStock, error: stockFetchError } = await supabase
        .from("stocks")
        .select("quantity")
        .eq("product_id", item.product_id)
        .single();

      if (stockFetchError) {
        console.error("Error fetching stock:", stockFetchError);
        continue;
      }

      const newQuantity = (currentStock.quantity || 0) - item.quantity;

      const { error: stockUpdateError } = await supabase
        .from("stocks")
        .update({ quantity: Math.max(0, newQuantity) })
        .eq("product_id", item.product_id);

      if (stockUpdateError) {
        console.error("Error updating stock:", stockUpdateError);
      }
    }

    return NextResponse.json({ order, items }, { status: 201 });
  } catch (error) {
    console.error("Error creating lending record:", error);
    return NextResponse.json(
      { error: "Failed to create lending record" },
      { status: 500 }
    );
  }
}
