/**
 * api.types.ts — Generic API response and pagination type definitions.
 *
 * `ApiResponse<T>`: The standard response envelope used by all API endpoints.
 *   All successful responses include `{ success: true, data: T }`.
 *   All error responses include `{ success: false, error: string }`.
 *
 * `PaginatedResponse<T>`: Extended envelope for paginated list endpoints
 *   (currently used by the asset list when page/limit are provided).
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}