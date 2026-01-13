
import { Response } from 'express';


export const setRefreshCookie = (res: Response, token: string, maxAgeMs: number): void => {
    const isProduction = process.env.NODE_ENV === 'production';
    
    res.cookie('refreshToken', token, {
        httpOnly: true,
        // 🛑 MUST be false for http://localhost:3000
        secure: isProduction, 
        // 🛑 'lax' is required for cross-origin localhost setups
        sameSite: isProduction ? 'strict' : 'lax', 
        maxAge: maxAgeMs,
        path: '/', 
    });
};