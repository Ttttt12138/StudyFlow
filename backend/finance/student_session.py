"""Read the existing Django session without exposing authentication credentials."""
from django.middleware.csrf import get_token
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers
from rest_framework.response import Response
from rest_framework.views import APIView


class StudentSessionSerializer(serializers.Serializer):
    authenticated = serializers.BooleanField()
    username = serializers.CharField(allow_null=True)
    csrf_token = serializers.CharField()


class StudentSessionView(APIView):
    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=StudentSessionSerializer)
    def get(self, request):
        response = Response({
            "authenticated": request.user.is_authenticated,
            "username": request.user.get_username() if request.user.is_authenticated else None,
            "csrf_token": get_token(request),
        })
        response["Cache-Control"] = "no-store"
        return response
