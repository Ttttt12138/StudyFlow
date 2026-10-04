from django.db import connection, DatabaseError, transaction
from django.db.migrations.executor import MigrationExecutor
from django.contrib.auth import get_user_model
from drf_spectacular.utils import extend_schema
from rest_framework import generics, permissions, status
from rest_framework.exceptions import ValidationError, NotFound
from rest_framework.response import Response
from rest_framework.views import APIView
from .calculations import forecast
from .models import SourceDocument, FinancialState, CalculationRun, AuditEvent
from .serializers import (
    SourceSerializer, StateWriteSerializer, StateResponseSerializer,
    ForecastRequestSerializer, ForecastResponseSerializer, HealthSerializer,
)
from .services import save_state, json_value, VersionConflict

class HealthView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    @extend_schema(responses=HealthSerializer)
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            executor = MigrationExecutor(connection)
            if executor.migration_plan(executor.loader.graph.leaf_nodes()):
                return Response({"status": "degraded", "database": "migrations_pending"}, status=503)
            return Response({"status": "ok", "database": "connected"})
        except DatabaseError:
            return Response({"status": "degraded", "database": "unavailable"}, status=503)

class SourceListView(generics.ListCreateAPIView):
    serializer_class = SourceSerializer

    def get_queryset(self):
        return SourceDocument.objects.filter(owner=self.request.user).order_by("-created_at")

    @transaction.atomic
    def perform_create(self, serializer):
        source = serializer.save(owner=self.request.user)
        AuditEvent.objects.create(
            owner=self.request.user, action="source.created", entity_id=source.id,
        )

class StateView(APIView):
    @extend_schema(responses=StateResponseSerializer)
    def get(self, request):
        state = FinancialState.objects.filter(owner=request.user).first()
        if not state:
            raise NotFound("No confirmed financial state. POST expected_version=0.")
        return Response(StateResponseSerializer(state).data)

    @extend_schema(request=StateWriteSerializer, responses={201: StateResponseSerializer})
    def post(self, request):
        serializer = StateWriteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        state = save_state(request.user, **serializer.validated_data)
        return Response(StateResponseSerializer(state).data, status=status.HTTP_201_CREATED)

class ForecastView(APIView):
    @extend_schema(request=ForecastRequestSerializer, responses={201: ForecastResponseSerializer})
    @transaction.atomic
    def post(self, request):
        serializer = ForecastRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        # Share the state-writer lock so validation and calculation use one current version.
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        state = FinancialState.objects.filter(owner=request.user).first()
        if state is None:
            raise NotFound("Confirm financial state before calculating.")
        if state.version != data["state_version"]:
            raise VersionConflict()
        try:
            result = forecast(state.snapshot, data["end_date"], data["include_estimates"])
        except ValueError as error:
            raise ValidationError({"end_date": str(error)})
        run = CalculationRun.objects.create(
            owner=request.user, state=state, inputs=json_value(data), result=result,
        )
        AuditEvent.objects.create(
            owner=request.user, action="forecast.calculated", entity_id=run.id,
            details={"state_version": state.version},
        )
        return Response({
            "id": str(run.id), "state_version": state.version,
            "engine_version": run.engine_version, "result": result,
        }, status=201)
