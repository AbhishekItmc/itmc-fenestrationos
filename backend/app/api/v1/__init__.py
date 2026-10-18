"""API v1 router aggregation."""
from fastapi import APIRouter

from . import (admin, auth, calc_runs, catalogue, customers, elevations, export, health, inventory, optimisation,
               production, projects, purchasing, quotes, reports)

api_router = APIRouter(prefix="/api/v1")
for r in (health.router, auth.router, customers.router, projects.router, elevations.router, catalogue.router,
          catalogue.calc_router, calc_runs.router, optimisation.cutting, optimisation.nesting, inventory.router,
          quotes.router, production.router, purchasing.router, export.router, reports.router, admin.router):
    api_router.include_router(r)
