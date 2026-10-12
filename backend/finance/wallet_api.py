from decimal import Decimal, InvalidOperation

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from . import money
from .execution_services import available
from .fx_rates import get_rate
from .wallets import balances, wallet
from .workflow_common import record, require
from .workflow_models import Corridor
from .workflow_serializers import CommandResponse


class BalancesView(APIView):
    @extend_schema(responses=CommandResponse)
    def get(self, request):
        item = wallet(request.user)
        return Response({"data": balances(item, available(item))})


class CorridorListView(APIView):
    @extend_schema(responses=CommandResponse, parameters=[
        OpenApiParameter("source_currency", str, required=False),
        OpenApiParameter("target_currency", str, required=False),
    ])
    def get(self, request):
        rows = Corridor.objects.filter(enabled=True)
        for name in ("source_currency", "target_currency"):
            if request.query_params.get(name):
                rows = rows.filter(**{name: request.query_params[name].upper()})
        return Response({"data": [record(row) for row in rows]})


class FxRateView(APIView):
    @extend_schema(responses=CommandResponse, parameters=[
        OpenApiParameter("base", str, required=True),
        OpenApiParameter("quote", str, required=True),
        OpenApiParameter("amount", str, required=False,
                         description="Optional positive amount in base; adds amount and converted (in quote) at the reference rate."),
    ])
    def get(self, request):
        base = request.query_params.get("base", "").upper()
        quote = request.query_params.get("quote", "").upper()
        require(base and quote, "Query parameters base and quote are required.")
        data = get_rate(base, quote)
        raw = request.query_params.get("amount")
        if raw is not None:
            # Indicative only: a planning aid at the reference rate, not an executable quote.
            try:
                amount = Decimal(raw)
            except InvalidOperation:
                amount = None
            require(amount is not None and amount.is_finite() and amount > 0, "AMOUNT_INVALID")
            amount = money.require_precision(amount, base)
            data = {**data, "amount": money.fmt(amount, base),
                    "converted": money.fmt(amount * Decimal(data["rate"]), quote)}
        return Response({"data": data})
