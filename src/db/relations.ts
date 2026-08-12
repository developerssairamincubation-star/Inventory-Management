// drizzle `relations()` definitions for the query API's `db.query.*` nested
// reads (used where a route needs a Supabase-style nested select in one
// round trip, e.g. a product with its stock/image/category joined).
import { relations } from "drizzle-orm";
import { departments } from "./schema/departments";
import { users } from "./schema/users";
import { sessions } from "./schema/sessions";
import { students } from "./schema/students";
import { staffs } from "./schema/staffs";
import { category } from "./schema/category";
import { products } from "./schema/products";
import { productImage } from "./schema/productImage";
import { stocks } from "./schema/stocks";
import { lendingOrder } from "./schema/lendingOrder";
import { lendingItem } from "./schema/lendingItem";
import { purchaseInvoice } from "./schema/purchaseInvoice";
import { purchaseInvoiceItem } from "./schema/purchaseInvoiceItem";

export const departmentsRelations = relations(departments, ({ many }) => ({
  users: many(users),
  students: many(students),
  staffs: many(staffs),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.departmentId], references: [departments.departmentId] }),
  sessions: many(sessions),
  products: many(products),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.userId] }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  department: one(departments, { fields: [students.departmentId], references: [departments.departmentId] }),
  lendingOrders: many(lendingOrder),
}));

export const staffsRelations = relations(staffs, ({ one, many }) => ({
  department: one(departments, { fields: [staffs.departmentId], references: [departments.departmentId] }),
  lendingOrdersAsBorrower: many(lendingOrder, { relationName: "borrowerStaff" }),
  lendingOrdersAsMentor: many(lendingOrder, { relationName: "mentorStaff" }),
}));

export const categoryRelations = relations(category, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(category, { fields: [products.categoryId], references: [category.categoryId] }),
  owner: one(users, { fields: [products.userId], references: [users.userId] }),
  stock: one(stocks, { fields: [products.productId], references: [stocks.productId] }),
  images: many(productImage),
  lendingItems: many(lendingItem),
}));

export const productImageRelations = relations(productImage, ({ one }) => ({
  product: one(products, { fields: [productImage.productId], references: [products.productId] }),
}));

export const stocksRelations = relations(stocks, ({ one }) => ({
  product: one(products, { fields: [stocks.productId], references: [products.productId] }),
}));

export const lendingOrderRelations = relations(lendingOrder, ({ one, many }) => ({
  borrowerStudent: one(students, { fields: [lendingOrder.borrowerStudentId], references: [students.studentId] }),
  borrowerStaff: one(staffs, {
    fields: [lendingOrder.borrowerStaffId],
    references: [staffs.staffId],
    relationName: "borrowerStaff",
  }),
  mentorStaff: one(staffs, {
    fields: [lendingOrder.mentorStaffId],
    references: [staffs.staffId],
    relationName: "mentorStaff",
  }),
  issuedByUser: one(users, { fields: [lendingOrder.issuedByUserId], references: [users.userId] }),
  items: many(lendingItem),
}));

export const lendingItemRelations = relations(lendingItem, ({ one }) => ({
  order: one(lendingOrder, { fields: [lendingItem.lendOrderId], references: [lendingOrder.lendingOrderId] }),
  product: one(products, { fields: [lendingItem.productId], references: [products.productId] }),
}));

export const purchaseInvoiceRelations = relations(purchaseInvoice, ({ one, many }) => ({
  owner: one(users, { fields: [purchaseInvoice.userId], references: [users.userId] }),
  items: many(purchaseInvoiceItem),
}));

export const purchaseInvoiceItemRelations = relations(purchaseInvoiceItem, ({ one }) => ({
  invoice: one(purchaseInvoice, { fields: [purchaseInvoiceItem.invoiceId], references: [purchaseInvoice.invoiceId] }),
  product: one(products, { fields: [purchaseInvoiceItem.productId], references: [products.productId] }),
}));
