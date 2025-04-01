export type FilteredInput = {
    start_date?: string;
    end_date?: string;
    sort_by?: string;
    order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    search?: string;
}