// drizzle `relations()` definitions for the query API's `db.query.*` nested
// reads (used where a route needs a Supabase-style nested select in one
// round trip, e.g. a product with its stock/image/category joined).
import { relations } from "drizzle-orm";
import { departments } from "./schema/departments";
import { coe_domains } from "./schema/coeDomains";
import { users } from "./schema/users";
import { sessions } from "./schema/sessions";
import { students } from "./schema/students";
import { category } from "./schema/category";
import { products } from "./schema/products";
import { product_image } from "./schema/productImage";
import { stocks } from "./schema/stocks";
import { lending_order } from "./schema/lendingOrder";
import { lending_item } from "./schema/lendingItem";
import { purchase_invoice } from "./schema/purchaseInvoice";
import { purchase_invoice_item } from "./schema/purchaseInvoiceItem";

export const departmentsRelations = relations(departments, ({ many }) => ({
  users: many(users),
  students: many(students),
}));

export const coeDomainsRelations = relations(coe_domains, ({ many }) => ({
  users: many(users),
  lendingOrders: many(lending_order),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  department: one(departments, { fields: [users.department_id], references: [departments.department_id] }),
  domain: one(coe_domains, { fields: [users.domain_id], references: [coe_domains.domain_id] }),
  sessions: many(sessions),
  products: many(products),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.user_id], references: [users.user_id] }),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  department: one(departments, { fields: [students.department_id], references: [departments.department_id] }),
  lendingOrders: many(lending_order),
}));

export const categoryRelations = relations(category, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(category, { fields: [products.category_id], references: [category.category_id] }),
  owner: one(users, { fields: [products.user_id], references: [users.user_id] }),
  stock: one(stocks, { fields: [products.product_id], references: [stocks.product_id] }),
  images: many(product_image),
  lendingItems: many(lending_item),
}));

export const productImageRelations = relations(product_image, ({ one }) => ({
  product: one(products, { fields: [product_image.product_id], references: [products.product_id] }),
}));

export const stocksRelations = relations(stocks, ({ one }) => ({
  product: one(products, { fields: [stocks.product_id], references: [products.product_id] }),
}));

export const lendingOrderRelations = relations(lending_order, ({ one, many }) => ({
  borrowerStudent: one(students, { fields: [lending_order.borrower_student_id], references: [students.student_id] }),
  issuedByUser: one(users, { fields: [lending_order.issued_by_user_id], references: [users.user_id] }),
  domain: one(coe_domains, { fields: [lending_order.domain_id], references: [coe_domains.domain_id] }),
  items: many(lending_item),
}));

export const lendingItemRelations = relations(lending_item, ({ one }) => ({
  order: one(lending_order, { fields: [lending_item.lend_order_id], references: [lending_order.lending_order_id] }),
  product: one(products, { fields: [lending_item.product_id], references: [products.product_id] }),
}));

export const purchaseInvoiceRelations = relations(purchase_invoice, ({ one, many }) => ({
  owner: one(users, { fields: [purchase_invoice.user_id], references: [users.user_id] }),
  items: many(purchase_invoice_item),
}));

export const purchaseInvoiceItemRelations = relations(purchase_invoice_item, ({ one }) => ({
  invoice: one(purchase_invoice, { fields: [purchase_invoice_item.invoice_id], references: [purchase_invoice.invoice_id] }),
  product: one(products, { fields: [purchase_invoice_item.product_id], references: [products.product_id] }),
}));
