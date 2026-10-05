import hashlib
import json
from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from .services import json_value
from .workflow_models import IdempotencyRecord,DemoWallet
from .workflow_common import require,record
from .workflow_serializers import CommandResponse,HistoryResponse
from .execution_services import available

class CommandView(generics.GenericAPIView):
    handler = None
    target_model = None
    operator_only = False
    idempotency_namespace = None

    @extend_schema(responses=CommandResponse, parameters=[OpenApiParameter(
        name="Idempotency-Key", location=OpenApiParameter.HEADER, required=True,
        type=str, description="Unique action key; reuse the same key and body when retrying.",
    )])
    @transaction.atomic
    def post(self,request,pk=None):
        if self.operator_only and not request.user.is_staff:
            raise PermissionDenied("Only the controlled demo operator can perform this transition.")
        obj = None
        owner = request.user
        if self.target_model:
            filters = {"pk":pk}
            if not self.operator_only: filters["owner"] = request.user
            obj = get_object_or_404(self.target_model,**filters)
            owner = obj.owner
        # Serialize all financial commands for a student, including operator callbacks.
        list(get_user_model().objects.select_for_update().filter(
            pk__in={owner.pk, request.user.pk}).order_by("pk"))
        if obj: obj.refresh_from_db()
        key = request.headers.get("Idempotency-Key","")
        require(1 <= len(key) <= 100,"Idempotency-Key header (1-100 characters) is required.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        scope = self.idempotency_namespace or request.path
        fingerprint = {"path": request.path, "body": data} if self.idempotency_namespace else data
        request_hash = hashlib.sha256(json.dumps(json_value(fingerprint),sort_keys=True).encode()).hexdigest()
        previous = IdempotencyRecord.objects.filter(owner=request.user,scope=scope,key=key).first()
        if previous:
            require(previous.request_hash == request_hash,"Idempotency key was used with a different request.")
            return Response(previous.response)
        result = self.handler(request.user,data,obj)
        payload = {"data":result}
        IdempotencyRecord.objects.create(owner=request.user,scope=scope,key=key,
            request_hash=request_hash,response=json_value(payload))
        return Response(payload,status=201)

class ReadView(APIView):
    model = None
    calendar = False

    @extend_schema(responses=HistoryResponse)
    def get(self,request,pk=None):
        queryset = self.model.objects.filter(owner=request.user).order_by("-created_at")
        if pk:
            obj = get_object_or_404(queryset,pk=pk)
            if self.calendar:
                return Response({"data":{"timeline":obj.result["timeline"],
                    "state_version":obj.state.version,"assumptions":obj.result["assumptions"]}})
            data = record(obj)
            if isinstance(obj,DemoWallet):
                data["available_balance"] = format(available(obj),".2f")
                data["is_simulated"] = True
            return Response({"data":data})
        paginator = PageNumberPagination()
        page = paginator.paginate_queryset(queryset,request)
        results = []
        for obj in page:
            data = record(obj)
            if isinstance(obj,DemoWallet):
                data["available_balance"] = format(available(obj),".2f")
                data["is_simulated"] = True
            results.append(data)
        return paginator.get_paginated_response(results)

class ResourceView(CommandView):
    model = None
    @extend_schema(responses=HistoryResponse)
    def get(self,request):
        view = ReadView()
        view.model = self.model
        return view.get(request)
