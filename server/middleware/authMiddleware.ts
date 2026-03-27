import type { Request, Response, NextFunction } from "express";

export const isOperatorOrAdmin = (req: Request, res: Response, next: NextFunction) => {
  const user = (req as any).user;
  if (!user || (user.role !== 'admin' && user.role !== 'operator')) {
    return res.status(403).json({ error: "Access denied. Operator or admin only." });
  }
  next();
};

export const isSystemAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!(req as any).user || (req as any).user.role !== 'admin') {
    return res.status(403).json({ error: "Access denied. System admin only." });
  }
  next();
};
