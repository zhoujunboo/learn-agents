export interface ApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

export interface JwtPayload {
  id: number;
  username: string;
  role: 'admin' | 'user';
}
