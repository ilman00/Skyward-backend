


export interface JwtUser {
  user_id: string;
  email: string;
  role: "admin" | "staff"| "marketer" | "customer" | "user";
}
