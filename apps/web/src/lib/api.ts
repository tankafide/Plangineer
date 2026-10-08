import { createQueryClient } from '@plangineer/api-client';

export const queryClient = createQueryClient();

export const apiUrl = `${window.location.origin}/rpc`;
