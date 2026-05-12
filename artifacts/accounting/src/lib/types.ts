export type Purchase = {
  id: string;
  date: string;
  description: string;
  amount: number;
};

export type ManapoolOrder = {
  id: string;
  date: string;
  grossTotal: number;
  shippingTotal: number;
  platformFees: number;
  netPayout: number;
};

export type DashboardStats = {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
};

export type WeeklyStats = {
  week: string;
  revenue: number;
  spending: number;
  orders: number;
  profit: number;
};
