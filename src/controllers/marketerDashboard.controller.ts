import { Request, Response } from "express";


export const getMarketerDashboardData = async (req: Request, res: Response) => {
    try { 
        const userId = req.user?.user_id;
        const role = req.user?.role;
        
        
        
     } catch (error) { }
}

